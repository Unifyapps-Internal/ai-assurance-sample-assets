// Vercel entry: every /api/*, /_assurance/* and /assurance.json request is rewritten here (see vercel.json).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../server/app.js';

const app = createApp();

export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return app(req, res);
}
