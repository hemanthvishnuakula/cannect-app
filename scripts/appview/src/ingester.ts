import WebSocket from 'ws'
import { decode } from 'cbor-x'
import { CID } from 'multiformats/cid'
import { createDb, AppViewDb } from './db.js'
import { config } from './config.js'

// AT Protocol record types
const COLLECTIONS = {
  POST: 'app.bsky.feed.post',
  LIKE: 'app.bsky.feed.like',
  REPOST: 'app.bsky.feed.repost',
  FOLLOW: 'app.bsky.graph.follow',
  BLOCK: 'app.bsky.graph.block',
  PROFILE: 'app.bsky.actor.profile',
}

interface CommitEvent {
  repo: string
  rev: string
  since: string | null
  commit: any // CID
  time: string
  tooBig: boolean
  blocks: Uint8Array
  ops: Array<{
    action: 'create' | 'update' | 'delete'
    path: string
    cid: any | null // CID
  }>
}

interface FirehoseMessage {
  t: string
  op: number
}

export class Ingester {
  private db: AppViewDb
  private ws: WebSocket | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private isRunning = false

  constructor(db: AppViewDb) {
    this.db = db
  }

  async start() {
    this.isRunning = true
    await this.connect()
  }

  stop() {
    this.isRunning = false
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  private async connect() {
    const cursor = this.getCursor()
    const url = cursor
      ? `${config.cannectPds.replace('https://', 'wss://')}/xrpc/com.atproto.sync.subscribeRepos?cursor=${cursor}`
      : `${config.cannectPds.replace('https://', 'wss://')}/xrpc/com.atproto.sync.subscribeRepos`

    console.log(`[Ingester] Connecting to ${url}`)

    this.ws = new WebSocket(url)

    this.ws.on('open', () => {
      console.log('[Ingester] Connected to PDS firehose')
      this.reconnectAttempts = 0
    })

    this.ws.on('message', async (data: Buffer) => {
      try {
        await this.handleMessage(data)
      } catch (err) {
        console.error('[Ingester] Error handling message:', err)
      }
    })

    this.ws.on('close', () => {
      console.log('[Ingester] Connection closed')
      if (this.isRunning) {
        this.scheduleReconnect()
      }
    })

    this.ws.on('error', (err) => {
      console.error('[Ingester] WebSocket error:', err)
    })
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Ingester] Max reconnection attempts reached')
      return
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
    this.reconnectAttempts++
    console.log(`[Ingester] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)
    setTimeout(() => this.connect(), delay)
  }

  private getCursor(): string | null {
    const row = this.db.prepare('SELECT pds_cursor FROM sync_state WHERE id = 1').get() as { pds_cursor: string | null } | undefined
    return row?.pds_cursor || null
  }

  private setCursor(cursor: string) {
    this.db.prepare('UPDATE sync_state SET pds_cursor = ?, last_sync = datetime("now") WHERE id = 1').run(cursor)
  }

  private async handleMessage(data: Buffer) {
    // AT Protocol firehose uses a specific framing format
    // The message consists of: header CBOR + body CBOR concatenated
    // We need to decode them sequentially
    
    try {
      // Try decoding as a single CBOR item first (array)
      const decoded = decode(data) as unknown

      if (!Array.isArray(decoded) || decoded.length < 2) {
        return
      }

      const [header, body] = decoded as [FirehoseMessage, unknown]

      if (header.t === '#commit' && header.op === 1) {
        await this.handleCommit(body as CommitEvent)
      }
    } catch (firstErr) {
      // If single decode fails, try sequential decoding
      try {
        // Use decodeMultiple for concatenated CBOR values
        const { decodeMultiple } = await import('cbor-x')
        const items = decodeMultiple(data) as unknown[]
        
        if (items.length < 2) return
        
        const header = items[0] as FirehoseMessage
        const body = items[1] as unknown
        
        if (header.t === '#commit' && header.op === 1) {
          await this.handleCommit(body as CommitEvent)
        }
      } catch {
        // Silently skip malformed messages
      }
    }
  }

  private async handleCommit(commit: CommitEvent) {
    const { repo: did, ops, blocks, rev } = commit

    console.log(`[Ingester] Commit from ${did}: ${ops.length} ops`)

    // Decode the CAR blocks to get record data
    const records = await this.decodeBlocks(blocks)
    console.log(`[Ingester] Decoded ${records.size} blocks`)

    for (const op of ops) {
      const [collection, rkey] = op.path.split('/')
      console.log(`[Ingester] Op: ${op.action} ${collection}/${rkey}`)

      if (op.action === 'delete') {
        await this.handleDelete(did, collection, rkey)
        continue
      }

      if (!op.cid) continue

      // Convert CID to string properly
      // CBOR decodes CIDs as Tagged objects with {value: Uint8Array, tag: 42}
      let cidStr: string
      if (typeof op.cid === 'string') {
        cidStr = op.cid
      } else if (op.cid.$link) {
        cidStr = op.cid.$link
      } else if (op.cid.value && op.cid.tag === 42) {
        // CBOR Tagged CID - value is the raw bytes
        // Skip the first byte (0x00 multibase prefix) and decode
        const cidBytes = op.cid.value instanceof Uint8Array ? op.cid.value : new Uint8Array(op.cid.value)
        const cid = CID.decode(cidBytes.slice(1)) // Skip 0x00 prefix
        cidStr = cid.toString()
      } else {
        // Try CID.asCID
        const asCid = CID.asCID(op.cid)
        if (asCid) {
          cidStr = asCid.toString()
        } else {
          console.log(`[Ingester] Unknown CID format:`, JSON.stringify(op.cid))
          continue
        }
      }
      
      console.log(`[Ingester] Looking for CID: ${cidStr}`)
      
      const record = records.get(cidStr)
      if (!record) {
        console.log(`[Ingester] No record found for CID ${cidStr}`)
        continue
      }

      await this.handleRecord(did, collection, rkey, cidStr, record)
    }

    // Update cursor
    this.setCursor(rev)
  }

  private async decodeBlocks(blocks: Uint8Array): Promise<Map<string, unknown>> {
    const records = new Map<string, unknown>()

    if (!blocks || blocks.length === 0) {
      console.log('[Ingester] No blocks to decode')
      return records
    }

    console.log(`[Ingester] Decoding ${blocks.length} bytes of blocks`)

    try {
      // Simple CAR parsing - skip header, iterate blocks
      let offset = 0

      // Read header length (varint)
      const headerLen = this.readVarint(blocks, offset)
      offset += headerLen.bytesRead + headerLen.value
      console.log(`[Ingester] Header length: ${headerLen.value}, offset now: ${offset}`)

      // Read blocks
      while (offset < blocks.length) {
        const blockLen = this.readVarint(blocks, offset)
        offset += blockLen.bytesRead

        if (blockLen.value === 0 || offset + blockLen.value > blocks.length) break

        const blockData = blocks.slice(offset, offset + blockLen.value)
        offset += blockLen.value

        try {
          // CID is at the start, followed by the data
          // For simplicity, decode the whole thing as CBOR and hope for the best
          const cidLen = this.getCidLength(blockData)
          if (cidLen > 0 && cidLen < blockData.length) {
            const cid = CID.decode(blockData.slice(0, cidLen))
            const data = decode(blockData.slice(cidLen))
            records.set(cid.toString(), data)
            console.log(`[Ingester] Decoded block: ${cid.toString().substring(0, 20)}...`)
          }
        } catch (blockErr) {
          console.log(`[Ingester] Block decode error:`, blockErr)
        }
      }
    } catch (err) {
      console.error('[Ingester] Error decoding blocks:', err)
    }

    return records
  }

  private readVarint(buf: Uint8Array, offset: number): { value: number; bytesRead: number } {
    let value = 0
    let bytesRead = 0
    let shift = 0

    while (offset + bytesRead < buf.length) {
      const byte = buf[offset + bytesRead]
      value |= (byte & 0x7f) << shift
      bytesRead++
      if ((byte & 0x80) === 0) break
      shift += 7
    }

    return { value, bytesRead }
  }

  private getCidLength(data: Uint8Array): number {
    // CIDv1 structure: version (1 byte) + codec varint + multihash
    // Most AT Protocol CIDs are CIDv1 with dag-cbor (0x71) and sha2-256
    if (data[0] === 0x01) {
      // Skip version byte
      let offset = 1

      // Read codec varint
      while (offset < data.length && (data[offset] & 0x80) !== 0) offset++
      offset++ // include last byte of codec

      // Read multihash: hash type varint + digest length varint + digest
      // Skip hash type
      while (offset < data.length && (data[offset] & 0x80) !== 0) offset++
      offset++

      // Read digest length
      const digestLen = this.readVarint(data, offset)
      offset += digestLen.bytesRead + digestLen.value

      return offset
    }
    return 0
  }

  private async handleRecord(did: string, collection: string, rkey: string, cid: string, record: unknown) {
    const uri = `at://${did}/${collection}/${rkey}`
    const rec = record as Record<string, unknown>

    try {
      switch (collection) {
        case COLLECTIONS.POST:
          await this.indexPost(uri, cid, did, rec)
          break
        case COLLECTIONS.LIKE:
          await this.indexLike(uri, did, rec)
          break
        case COLLECTIONS.REPOST:
          await this.indexRepost(uri, did, rec)
          break
        case COLLECTIONS.FOLLOW:
          await this.indexFollow(uri, did, rec)
          break
        case COLLECTIONS.BLOCK:
          await this.indexBlock(uri, did, rec)
          break
        case COLLECTIONS.PROFILE:
          await this.indexProfile(did, rec)
          break
      }
    } catch (err) {
      console.error(`[Ingester] Error indexing ${collection}:`, err)
    }
  }

  private async handleDelete(did: string, collection: string, rkey: string) {
    const uri = `at://${did}/${collection}/${rkey}`

    try {
      switch (collection) {
        case COLLECTIONS.POST:
          this.db.prepare('DELETE FROM posts WHERE uri = ?').run(uri)
          break
        case COLLECTIONS.LIKE:
          this.db.prepare('DELETE FROM likes WHERE uri = ?').run(uri)
          break
        case COLLECTIONS.REPOST:
          this.db.prepare('DELETE FROM reposts WHERE uri = ?').run(uri)
          break
        case COLLECTIONS.FOLLOW:
          this.db.prepare('DELETE FROM follows WHERE uri = ?').run(uri)
          break
        case COLLECTIONS.BLOCK:
          this.db.prepare('DELETE FROM blocks WHERE uri = ?').run(uri)
          break
      }
    } catch (err) {
      console.error(`[Ingester] Error deleting ${collection}:`, err)
    }
  }

  private async indexPost(uri: string, cid: string, authorDid: string, record: Record<string, unknown>) {
    const text = record.text as string || ''
    const createdAt = record.createdAt as string || new Date().toISOString()

    // Parse reply
    let replyParent: string | null = null
    let replyRoot: string | null = null
    if (record.reply) {
      const reply = record.reply as { parent?: { uri: string }; root?: { uri: string } }
      replyParent = reply.parent?.uri || null
      replyRoot = reply.root?.uri || null
    }

    // Parse embed
    let embedType: string | null = null
    let embedData: string | null = null
    if (record.embed) {
      const embed = record.embed as { $type: string }
      embedType = embed.$type?.split('.').pop() || null
      embedData = JSON.stringify(record.embed)
    }

    // Parse facets
    const facets = record.facets ? JSON.stringify(record.facets) : null

    // Parse langs
    const langs = Array.isArray(record.langs) ? JSON.stringify(record.langs) : null

    this.db.prepare(`
      INSERT OR REPLACE INTO posts (uri, cid, author_did, text, reply_parent, reply_root, embed_type, embed_data, facets, langs, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uri, cid, authorDid, text, replyParent, replyRoot, embedType, embedData, facets, langs, createdAt)

    console.log(`[Ingester] Indexed post: ${uri.slice(-20)}`)
  }

  private async indexLike(uri: string, authorDid: string, record: Record<string, unknown>) {
    const subject = record.subject as { uri: string } | undefined
    if (!subject?.uri) return

    const createdAt = record.createdAt as string || new Date().toISOString()

    this.db.prepare(`
      INSERT OR REPLACE INTO likes (uri, subject_uri, author_did, created_at)
      VALUES (?, ?, ?, ?)
    `).run(uri, subject.uri, authorDid, createdAt)
  }

  private async indexRepost(uri: string, authorDid: string, record: Record<string, unknown>) {
    const subject = record.subject as { uri: string } | undefined
    if (!subject?.uri) return

    const createdAt = record.createdAt as string || new Date().toISOString()

    this.db.prepare(`
      INSERT OR REPLACE INTO reposts (uri, subject_uri, author_did, created_at)
      VALUES (?, ?, ?, ?)
    `).run(uri, subject.uri, authorDid, createdAt)
  }

  private async indexFollow(uri: string, authorDid: string, record: Record<string, unknown>) {
    const subject = record.subject as string | undefined
    if (!subject) return

    const createdAt = record.createdAt as string || new Date().toISOString()

    this.db.prepare(`
      INSERT OR REPLACE INTO follows (uri, subject_did, author_did, created_at)
      VALUES (?, ?, ?, ?)
    `).run(uri, subject, authorDid, createdAt)
  }

  private async indexBlock(uri: string, authorDid: string, record: Record<string, unknown>) {
    const subject = record.subject as string | undefined
    if (!subject) return

    const createdAt = record.createdAt as string || new Date().toISOString()

    this.db.prepare(`
      INSERT OR REPLACE INTO blocks (uri, subject_did, author_did, created_at)
      VALUES (?, ?, ?, ?)
    `).run(uri, subject, authorDid, createdAt)
  }

  private async indexProfile(did: string, record: Record<string, unknown>) {
    const displayName = record.displayName as string || null
    const description = record.description as string || null

    // Get avatar/banner CIDs
    let avatarCid: string | null = null
    let bannerCid: string | null = null

    if (record.avatar) {
      const avatar = record.avatar as { ref?: { $link: string } }
      avatarCid = avatar.ref?.$link || null
    }

    if (record.banner) {
      const banner = record.banner as { ref?: { $link: string } }
      bannerCid = banner.ref?.$link || null
    }

    // Upsert profile - need to get handle from somewhere
    // For now, use did as placeholder handle
    this.db.prepare(`
      INSERT INTO profiles (did, handle, display_name, description, avatar_cid, banner_cid)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(did) DO UPDATE SET
        display_name = excluded.display_name,
        description = excluded.description,
        avatar_cid = excluded.avatar_cid,
        banner_cid = excluded.banner_cid,
        indexed_at = datetime('now')
    `).run(did, did, displayName, description, avatarCid, bannerCid)

    console.log(`[Ingester] Indexed profile: ${did}`)
  }
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('[Ingester] Starting Cannect AppView Ingester')
  const db = createDb()
  const ingester = new Ingester(db)

  process.on('SIGINT', () => {
    console.log('\n[Ingester] Shutting down...')
    ingester.stop()
    process.exit(0)
  })

  ingester.start()
}
