// Vercel entry: every request is rewritten here (see vercel.json).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../src/app.js';

const app = createApp();

export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return app(req, res);
}
