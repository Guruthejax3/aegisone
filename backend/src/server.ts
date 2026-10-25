import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from './app.ts';
const secret = process.env.AEGIS_HMAC_SECRET ?? randomBytes(32).toString('hex');
if (process.env.NODE_ENV === 'production' && (!process.env.AEGIS_HMAC_SECRET || !process.env.AEGIS_OPERATOR_TOKEN || !process.env.AEGIS_APPROVER_TOKEN || !process.env.AEGIS_ADMIN_TOKEN)) throw new Error('Set HMAC secret and operator/approver/admin tokens before production startup.');
const sandbox = process.env.NODE_ENV !== 'production' && process.env.AEGIS_SANDBOX !== 'false';
const operator = process.env.AEGIS_OPERATOR_TOKEN ?? (sandbox ? 'aegis-sandbox-operator' : randomBytes(24).toString('base64url'));
const approver = process.env.AEGIS_APPROVER_TOKEN ?? (sandbox ? 'aegis-sandbox-approver' : randomBytes(24).toString('base64url'));
const admin = process.env.AEGIS_ADMIN_TOKEN ?? (sandbox ? 'aegis-sandbox-admin' : randomBytes(24).toString('base64url'));
if (new Set([operator,approver,admin]).size !== 3) throw new Error('Operator, approver, and admin credentials must be distinct.');
const db = new DatabaseSync(process.env.AEGIS_DB_PATH ?? 'aegisone.sqlite');
const { server } = createApp(db,{secret,tokens:{[operator]:{id:'local-operator',role:'operator'},[approver]:{id:'local-approver',role:'approver'},[admin]:{id:'local-admin',role:'admin'}},rateLimit:Number(process.env.AEGIS_RATE_LIMIT ?? 120),sandbox});
const port=Number(process.env.PORT ?? 3001); server.listen(port,'127.0.0.1',()=>{ console.log(`AegisOne backend listening at http://127.0.0.1:${port}`); if(process.env.AEGIS_OPERATOR_TOKEN) console.log('Operator token loaded from environment.'); else console.log(`Local operator token: ${operator}`); if(process.env.AEGIS_APPROVER_TOKEN) console.log('Approver token loaded from environment.'); else console.log(`Local approver token: ${approver}`); });


