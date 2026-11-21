//! Windows Job Object that ties the Bun sidecar to the shell process.
//!
//! The shell creates a job with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` and puts
//! the sidecar into it. The job handle is held for the lifetime of the shell;
//! when the shell exits — normally or by being killed in Task Manager — Windows
//! closes the handle and terminates every process in the job. This is the OS
//! guarantee that the server can never be left behind, and it replaces the old
//! owner-marker / PID-verification / watch-thread machinery.
//!
//! On non-Windows platforms this is a no-op: the handle is a unit type and
//! `assign` always succeeds, so callers need no `cfg` branches.

#[cfg(windows)]
mod win {
  use std::ffi::c_void;

  #[link(name = "kernel32")]
  extern "system" {
    fn CreateJobObjectW(attributes: *mut c_void, name: *const u16) -> *mut c_void;
    fn SetInformationJobObject(
      job: *mut c_void,
      class: i32,
      info: *mut c_void,
      len: u32,
    ) -> i32;
    fn AssignProcessToJobObject(job: *mut c_void, process: *mut c_void) -> i32;
    fn OpenProcess(desired_access: u32, inherit_handle: i32, process_id: u32) -> *mut c_void;
    fn CloseHandle(handle: *mut c_void) -> i32;
  }

  const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: i32 = 9;
  const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;
  const PROCESS_SET_QUOTA: u32 = 0x0100;
  const PROCESS_TERMINATE: u32 = 0x0001;

  #[repr(C)]
  #[allow(non_snake_case)]
  struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    PerProcessUserTimeLimit: i64,
    PerJobUserTimeLimit: i64,
    LimitFlags: u32,
    MinimumWorkingSetSize: usize,
    MaximumWorkingSetSize: usize,
    ActiveProcessLimit: u32,
    PriorityClass: u32,
    Affinity: usize,
    SchedulingClass: u32,
  }

  #[repr(C)]
  #[allow(non_snake_case)]
  struct IO_COUNTERS {
    ReadOperationCount: u64,
    WriteOperationCount: u64,
    OtherOperationCount: u64,
    ReadTransferCount: u64,
    WriteTransferCount: u64,
    OtherTransferCount: u64,
  }

  #[repr(C)]
  #[allow(non_snake_case)]
  struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    BasicLimitInformation: JOBOBJECT_BASIC_LIMIT_INFORMATION,
    IoInfo: IO_COUNTERS,
    ProcessMemoryLimit: usize,
    JobMemoryLimit: usize,
    PeakProcessMemoryUsed: usize,
    PeakJobMemoryUsed: usize,
  }

  /// Owns the job handle. Deliberately has no `Drop`: the handle must stay open
  /// until the OS closes it at process exit, which is what triggers the kill.
  pub struct JobHandle(*mut c_void);

  // The handle is owned by this process and used only from the shell thread.
  unsafe impl Send for JobHandle {}

  pub fn create_kill_on_close_job() -> Option<JobHandle> {
    unsafe {
      let job = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
      if job.is_null() {
        return None;
      }
      let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
      info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      let ok = SetInformationJobObject(
        job,
        JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
        &mut info as *mut _ as *mut c_void,
        std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
      );
      if ok == 0 {
        CloseHandle(job);
        return None;
      }
      Some(JobHandle(job))
    }
  }

  pub fn assign_pid(job: &JobHandle, pid: u32) -> bool {
    unsafe {
      let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
      if process.is_null() {
        return false;
      }
      let ok = AssignProcessToJobObject(job.0, process);
      CloseHandle(process);
      ok != 0
    }
  }
}

/// A job handle held for the lifetime of the shell. On Windows it owns a real
/// kernel handle; elsewhere it is a zero-sized no-op.
#[cfg(windows)]
pub struct SidecarJob(Option<win::JobHandle>);

#[cfg(not(windows))]
pub struct SidecarJob(());

impl SidecarJob {
  /// Creates the kill-on-close job. Returns `None` only on Windows when the OS
  /// call fails; callers should log and continue (the explicit shutdown path is
  /// still a backstop), but a `None` means the OS guarantee is unavailable.
  pub fn create() -> Option<Self> {
    #[cfg(windows)]
    {
      win::create_kill_on_close_job().map(|h| SidecarJob(Some(h)))
    }
    #[cfg(not(windows))]
    {
      Some(SidecarJob(()))
    }
  }

  /// Puts a process into the job so it dies with the shell.
  pub fn assign(&self, pid: u32) -> bool {
    #[cfg(windows)]
    {
      match &self.0 {
        Some(job) => win::assign_pid(job, pid),
        None => false,
      }
    }
    #[cfg(not(windows))]
    {
      let _ = pid;
      true
    }
  }
}
