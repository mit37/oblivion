import { InMemoryNetwork } from './in-memory-transport'
import type { MessageTransport } from './transport'

/**
 * One network per browser tab, for the app's local demo mode.
 *
 * Contacts inside the same tab can talk to each other with no outbound network
 * at all; nothing crosses tabs or machines, which is exactly what the UI says
 * next to the connection status. Tests never use this — they build their own
 * `InMemoryNetwork`.
 */
const tabNetwork = new InMemoryNetwork()

export function localNetwork(): InMemoryNetwork {
  return tabNetwork
}

export function createLocalTransport(name = 'local'): MessageTransport {
  return tabNetwork.createTransport(name)
}
