import { createRequire } from 'node:module'
import { mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

const databasePath = process.argv[2]
if (!databasePath?.startsWith('/')) {
  throw new Error('usage: init-db.mjs /absolute/path/to/local.db')
}

const require = createRequire('/workspace/package.json')
const { createClient } = require('@libsql/client')

await mkdir(dirname(databasePath), { recursive: true })
await rm(databasePath, { force: true })

const client = createClient({ url: `file:${databasePath}`, authToken: 'local-evaluator-token' })
const fixedTimestamp = 1704067200

await client.batch(
  [
    { sql: 'PRAGMA foreign_keys = ON' },
    {
      sql: `CREATE TABLE categories (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        slug TEXT NOT NULL UNIQUE,
        color TEXT,
        icon TEXT,
        created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at INTEGER
      )`,
    },
    {
      sql: `CREATE TABLE bookmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT,
        category_id TEXT REFERENCES categories(id),
        tags TEXT,
        favicon TEXT,
        screenshot TEXT,
        overview TEXT,
        og_image TEXT,
        og_title TEXT,
        og_description TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        last_visited INTEGER,
        notes TEXT,
        is_archived INTEGER NOT NULL DEFAULT 0,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        search_results TEXT
      )`,
    },
    ...[
      ['development', 'Development', 'Programming and development resources', '#0ea5e9', '💻'],
      ['design', 'Design', 'Design tools and inspiration', '#f43f5e', '🎨'],
      ['productivity', 'Productivity', 'Tools and resources for getting things done', '#22c55e', '⚡'],
      ['learning', 'Learning', 'Educational resources and tutorials', '#8b5cf6', '📚'],
    ].map(([id, name, description, color, icon]) => ({
      sql: `INSERT INTO categories
        (id, name, description, slug, color, icon, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, name, description, id, color, icon, fixedTimestamp, fixedTimestamp],
    })),
    ...[
      ['https://github.com', 'GitHub', 'github', 'Where the world builds software', 'development', 'GitHub is where developers shape the future of software together.', 1],
      ['https://figma.com', 'Figma', 'figma', 'The collaborative interface design tool', 'design', 'Figma is a collaborative design tool for building meaningful products.', 1],
      ['https://notion.so', 'Notion', 'notion', 'All-in-one workspace', 'productivity', 'Notion combines notes, documents, projects, and knowledge in one workspace.', 1],
      ['https://www.coursera.org', 'Coursera', 'coursera', 'Learn without limits', 'learning', 'Coursera offers online courses from universities and companies.', 0],
      ['https://react.dev', 'React', 'react', 'The library for web and native user interfaces', 'development', 'React is the library for web and native user interfaces.', 1],
      ['https://dribbble.com', 'Dribbble', 'dribbble', "Discover the world's top designers and creatives", 'design', 'Dribbble is a destination for discovering and showcasing creative work.', 0],
    ].map(([url, title, slug, description, categoryId, overview, favorite]) => ({
      sql: `INSERT INTO bookmarks
        (url, title, slug, description, category_id, overview, created_at, updated_at, is_archived, is_favorite)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      args: [url, title, slug, description, categoryId, overview, fixedTimestamp, fixedTimestamp, favorite],
    })),
  ],
  'write',
)

client.close()
process.stdout.write(JSON.stringify({ databasePath, categories: 4, bookmarks: 6 }) + '\n')
