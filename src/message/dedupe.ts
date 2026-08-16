/** 有界消息 ID 去重集合，拦截长连接重放。 */
export class MessageDedupe {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];
  private readonly capacity: number;
  public constructor(capacity: number) {
    this.capacity = capacity;
  }
  public accept(messageId: string): boolean {
    if (this.seen.has(messageId)) return false;
    this.seen.add(messageId);
    this.order.push(messageId);
    while (this.order.length > this.capacity) {
      const oldest = this.order.shift();
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }
}
