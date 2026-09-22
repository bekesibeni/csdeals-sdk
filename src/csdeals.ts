import { type CallOptions, CsDealsClient, type CsDealsClientOptions, type HttpMethod } from "./core/client.js";
import { CsDealsError } from "./core/errors.js";
import { initAccountModule } from "./modules/account/index.js";
import { CsDealsFeed, LiveBook, type LiveBookOptions } from "./modules/feed/index.js";
import type { FeedOptions } from "./modules/feed/types.js";
import { initMarketModule } from "./modules/market/index.js";
import { initSellingModule } from "./modules/selling/index.js";
import { initTradingModule } from "./modules/trading/index.js";
import { verifyWebhook } from "./modules/webhooks/index.js";
import type { VerifiedWebhook, WebhookHeaders } from "./modules/webhooks/types.js";

export interface CsDealsSDKOptions extends CsDealsClientOptions {
  /** `whsec_...`; enables `verifyWebhook`. Derived from the API key, so rerolling the key rotates it. */
  webhookSecret?: string;
}

/** CS Deals v1 client. Server-to-server only: the key carries full account authority. */
export class CsDealsSDK {
  readonly market;
  readonly trading;
  readonly selling;
  readonly account;
  private readonly client: CsDealsClient;
  private readonly webhookSecret: string | undefined;

  constructor(options: CsDealsSDKOptions) {
    this.client = new CsDealsClient(options);
    this.webhookSecret = options.webhookSecret?.trim() || undefined;
    this.market = initMarketModule(this.client);
    this.trading = initTradingModule(this.client);
    this.selling = initSellingModule(this.client);
    this.account = initAccountModule(this.client);
  }

  /** Verifies and parses a delivery against the constructor secret. Pass the raw body bytes. */
  verifyWebhook(
    rawBody: string | Uint8Array,
    headers: WebhookHeaders,
    options?: { nowSeconds?: number; toleranceSeconds?: number },
  ): VerifiedWebhook {
    if (!this.webhookSecret) {
      throw new CsDealsError({
        key: "NOT_CONFIGURED",
        status: 0,
        message: "CsDealsSDK was constructed without a webhookSecret",
      });
    }
    return verifyWebhook(rawBody, headers, { secret: this.webhookSecret, ...options });
  }

  /** A listing-activity socket. Call `connect()` on it; at most 3 per user. */
  feed(options?: FeedOptions): CsDealsFeed {
    return new CsDealsFeed(this.client.feedUrl(), options);
  }

  /** A self-syncing local copy of the active book (one socket + one `GET /book` per sync). */
  async liveBook(options: LiveBookOptions & { feed?: FeedOptions } = {}): Promise<LiveBook> {
    const book = new LiveBook(
      this.feed(options.feed),
      (appId) => this.market.book(appId !== undefined ? { app_id: appId } : {}),
      options,
    );
    await book.start();
    return book;
  }

  /** Escape hatch for routes this SDK does not model. GETs retry; writes never do. */
  request<T = unknown>(method: HttpMethod, path: string, options?: CallOptions): Promise<T> {
    return this.client.request<T>(method, path, options);
  }
}
