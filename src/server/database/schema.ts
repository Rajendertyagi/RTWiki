import { sql } from 'drizzle-orm'
import { integer, json, sqliteTable, text } from 'drizzle-orm/bun-sqlite'

export const pages = sqliteTable('pages', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  title: text('title').notNull().default(''),
  content: text('content').notNull().default(''),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  deletedAt: text('deleted_at'),
  version: integer('version').notNull().default(0)
})

export const migrations = sqliteTable('migrations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  appliedAt: text('applied_at').notNull().default(sql`CURRENT_TIMESTAMP`)
})

export const searchIndex = sqliteTable('search_index', {
  pageId: text('page_id')
    .primaryKey()
    .references(() => pages.id, {
      onDelete: 'cascade'
    }),
  title: text('title').notNull().default(''),
  content: text('content').notNull().default('')
})
