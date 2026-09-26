import type { CsDealsClient } from '../../core/client.js';
import type { LeanListing } from '../../core/types.js';
import type {
  DelistManyResult,
  DelistResult,
  EditListingsResult,
  GetMyListingsParams,
  ListGroup,
  ListingEdit,
  ListResult,
  MyListingsResponse,
  MyListingsValue,
  PriceDecay,
  SellGroup,
  SellResult,
  SteamInventoryResponse,
} from './types.js';

function decay(curve: PriceDecay | undefined) {
  return curve && { start_price: curve.startPrice, end_price: curve.endPrice, total_hours: curve.totalHours };
}

function edit(change: ListingEdit) {
  return { listing_id: change.listingId, price: change.price, price_decay: decay(change.priceDecay), amount: change.amount };
}

export function initSellingModule(client: CsDealsClient) {
  return {
    /** The account's live Steam inventory, one row per stack, each with a 30-minute `token`. 5/min. */
    async getSteamInventory(appId: number): Promise<SteamInventoryResponse> {
      return client.get('steam-inventory', { app_id: appId });
    },

    /** Lists straight from Steam: the account gets a trade offer, and items list once it is accepted. */
    async sell(groups: SellGroup[]): Promise<SellResult> {
      return client.post('sell', {
        listings: groups.map((group) => ({
          items: group.items.map((line) => ({ token: line.token, amount: line.amount })),
          price: group.price,
        })),
      });
    },

    /** Lists backpack items, one listing per group. */
    async list(groups: ListGroup[]): Promise<ListResult> {
      return client.post('list', {
        listings: groups.map((group) => ({
          items: group.items.map((line) => ({ id: line.id, amount: line.amount })),
          price: group.price,
          price_decay: decay(group.priceDecay),
        })),
      });
    },

    async editListing(change: ListingEdit): Promise<LeanListing> {
      return client.patch('list', edit(change));
    },

    /** Up to 50 edits; each succeeds or fails on its own. */
    async editListings(changes: ListingEdit[]): Promise<EditListingsResult> {
      return client.patch('list', { listings: changes.map(edit) });
    },

    /** Takes a listing down; its items return to the backpack. */
    async delist(listingId: number): Promise<DelistResult> {
      return client.post('delist', { listing_id: listingId });
    },

    async delistMany(listingIds: number[]): Promise<DelistManyResult> {
      return client.post('delist', { listing_ids: listingIds });
    },

    async getMyListings(params: GetMyListingsParams = {}): Promise<MyListingsResponse> {
      return client.get('my-listings', {
        app_id: params.appId,
        status: params.status,
        page: params.page ?? 1,
        limit: params.limit ?? 100,
      });
    },

    async getMyListingsValue(appId?: number): Promise<MyListingsValue> {
      return client.get('my-listings/value', { app_id: appId });
    },
  };
}

export * from './types.js';
