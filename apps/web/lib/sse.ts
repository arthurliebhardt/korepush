/** Format a named Server-Sent Events frame (`event:` + `data:`). */
export function sse(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`;
}
