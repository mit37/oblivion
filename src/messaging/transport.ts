/**
 * What the messaging service needs from a network.
 *
 * Deliberately tiny: publish bytes to a content topic, and be told about bytes
 * other people published there. The live Waku light node and the in-memory
 * double both fit through it, which is what lets the protocol be tested without
 * a network.
 */
export interface TransportMessage {
  readonly topic: string
  readonly bytes: Uint8Array
}

export type MessageHandler = (message: TransportMessage) => void | Promise<void>

export interface MessageTransport {
  /** `waku` or `memory`, shown in the UI so the user knows what is connected. */
  readonly name: string
  start(): Promise<void>
  stop(): Promise<void>
  subscribe(topic: string, handler: MessageHandler): Promise<() => void>
  publish(topic: string, bytes: Uint8Array): Promise<void>
}
