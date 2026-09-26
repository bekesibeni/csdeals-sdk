import { CsDealsClient, type CsDealsClientOptions } from './core/client.js';
import { initAccountModule } from './modules/account/index.js';
import { initMarketModule } from './modules/market/index.js';
import { initSellingModule } from './modules/selling/index.js';
import { initTradingModule } from './modules/trading/index.js';
import { initWebhooksModule } from './modules/webhooks/index.js';
import { CsDealsWebSocket, LiveBook } from './ws/index.js';
import type { CsDealsWebSocketOptions, FeedEventName, LiveBookOptions } from './ws/types.js';

export interface CsDealsSDKOptions extends CsDealsClientOptions {
  /** `whsec_...`, only needed to verify webhooks. Derived from the API key: rerolling the key rotates it. */
  webhookSecret?: string;
}

const BOOK_EVENTS: FeedEventName[] = ['listing.created', 'listing.price_changed', 'listing.amount_changed', 'listing.removed'];

/** CS Deals public v1. Server-to-server only: the key carries full account authority. */
export class CsDealsSDK {
  public readonly market;
  public readonly trading;
  public readonly selling;
  public readonly account;
  public readonly webhooks;
  public readonly client: CsDealsClient;

  constructor(options: CsDealsSDKOptions) {
    this.client = new CsDealsClient(options);
    this.market = initMarketModule(this.client);
    this.trading = initTradingModule(this.client);
    this.selling = initSellingModule(this.client);
    this.account = initAccountModule(this.client);
    this.webhooks = initWebhooksModule(options.webhookSecret);
  }

  /** The listing feed. Not connected until `connect()`. */
  createWebSocket(options?: CsDealsWebSocketOptions): CsDealsWebSocket {
    return new CsDealsWebSocket(this.client, options);
  }

  /** A self-correcting local copy of the book on its own socket. Not running until `start()`. */
  createLiveBook(options: LiveBookOptions = {}): LiveBook {
    const socket = this.createWebSocket({
      ...options.socket,
      events: BOOK_EVENTS,
      ...(options.appId === undefined ? {} : { appIds: [options.appId] }),
    });
    const readBook = async () => {
      const read = await this.market.getBook({ appId: options.appId });
      if (read.notModified) throw new Error('GET /book answered 304 to a read without an etag');
      return read.data;
    };
    return new LiveBook(socket, readBook, options);
  }

  destroy(): void {
    this.client.destroy();
  }
}
