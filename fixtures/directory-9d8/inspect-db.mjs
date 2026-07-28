import { createRequire } from 'node:module'

const databasePath = process.argv[2]
const requestedSlug = process.argv[3]
if (!databasePath?.startsWith('/')) {
  throw new Error('usage: inspect-db.mjs /absolute/path/to/local.db [slug]')
}

const require = createRequire('/workspace/package.json')
const { createClient } = require('@libsql/client')
const client = createClient({ url: `file:${databasePath}`, authToken: 'local-evaluator-token' })

if (requestedSlug) {
  const result = await client.execute({
    sql: `SELECT b.id, b.slug, b.title, b.description, b.is_favorite,
      c.id AS category_id, c.name AS category_name
      FROM bookmarks b LEFT JOIN categories c ON c.id = b.category_id
      WHERE b.slug = ? LIMIT 1`,
    args: [requestedSlug],
  })
  process.stdout.write(JSON.stringify({ bookmark: result.rows[0] ?? null }) + '\n')
} else {
  const categories = await client.execute('SELECT id, name FROM categories ORDER BY id')
  const bookmarks = await client.execute('SELECT slug, title, category_id FROM bookmarks ORDER BY id')
  process.stdout.write(
    JSON.stringify({
      categoryCount: categories.rows.length,
      bookmarkCount: bookmarks.rows.length,
      categories: categories.rows,
      bookmarks: bookmarks.rows,
    }) + '\n',
  )
}

client.close()
