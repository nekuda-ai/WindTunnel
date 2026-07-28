import { createRequire } from 'node:module'

const databasePath = process.argv[2]
const slug = process.argv[3]
if (!databasePath?.startsWith('/') || !/^[a-z0-9-]+$/.test(slug || '')) {
  throw new Error('usage: mutate-db.mjs /absolute/path/to/local.db slug')
}

const require = createRequire('/workspace/package.json')
const { createClient } = require('@libsql/client')
const client = createClient({ url: `file:${databasePath}`, authToken: 'local-evaluator-token' })

const deleted = await client.execute({
  sql: 'DELETE FROM bookmarks WHERE slug = ?',
  args: [slug],
})
const remaining = await client.execute('SELECT count(*) AS count FROM bookmarks')
client.close()

process.stdout.write(JSON.stringify({
  deleted: Number(deleted.rowsAffected),
  slug,
  bookmarkCount: Number(remaining.rows[0].count),
}) + '\n')
