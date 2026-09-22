import { type CsDealsClient, pickRequestOptions } from "../../core/client.js";
import { type IterateOptions, iteratePages } from "../../core/paginate.js";
import type { LeanListing, RequestOptions } from "../../core/types.js";
import {
  assertLines,
  assertOneOf,
  assertPositiveInt,
  assertPricing,
  assertTokenLines,
  invalidRequest,
} from "../../core/validate.js";
import type {
  DelistManyResult,
  DelistResult,
  EditListingsResult,
  ListingEdit,
  ListParams,
  ListResult,
  MyListing,
  MyListingsParams,
  MyListingsResponse,
  MyListingsValue,
  MyListingsValueParams,
  SellParams,
  SellResult,
  SteamInventoryParams,
  SteamInventoryResponse,
} from "./types.js";

const MY_LISTING_STATUSES = ["ACTIVE", "DISABLED", "FILLED", "PRIVATE"] as const;

function editBody(edit: ListingEdit, what: string): Record<string, unknown> {
  assertPositiveInt(edit?.listing_id, `${what}.listing_id`);
  assertPricing(edit, what, false);
  if (edit.amount !== undefined) assertPositiveInt(edit.amount, `${what}.amount`);
  if (edit.price === undefined && edit.price_decay === undefined && edit.amount === undefined) {
    invalidRequest(`${what} changes nothing: send price, price_decay or amount`);
  }
  return {
    listing_id: edit.listing_id,
    ...(edit.price !== undefined ? { price: edit.price } : {}),
    ...(edit.price_decay !== undefined ? { price_decay: edit.price_decay } : {}),
    ...(edit.amount !== undefined ? { amount: edit.amount } : {}),
  };
}

export function initSellingModule(client: CsDealsClient) {
  const module = {
    /** Your live Steam inventory, one row per stack, each with a 30-minute `token`. 5/min. */
    async steamInventory(params: SteamInventoryParams): Promise<SteamInventoryResponse> {
      assertPositiveInt(params?.app_id, "app_id");
      return client.get("/public/v1/steam-inventory", {
        ...pickRequestOptions(params),
        query: { app_id: params.app_id },
      });
    },

    /** Lists straight from Steam: we get a trade offer, and items list once it is accepted. */
    async sell(params: SellParams): Promise<SellResult> {
      assertLines(params.listings, "listings");
      params.listings.forEach((group, i) => {
        assertTokenLines(group?.items, `listings[${i}].items`);
        assertPositiveInt(group.price, `listings[${i}].price`);
      });
      return client.post(
        "/public/v1/sell",
        {
          listings: params.listings.map((group) => ({
            items: group.items.map((line) => ({ token: line.token, amount: line.amount })),
            price: group.price,
          })),
        },
        pickRequestOptions(params),
      );
    },

    /** Lists backpack items, one listing per group. */
    async list(params: ListParams): Promise<ListResult> {
      assertLines(params.listings, "listings");
      params.listings.forEach((group, i) => {
        assertLines(group?.items, `listings[${i}].items`);
        group.items.forEach((line, j) => {
          assertPositiveInt(line?.id, `listings[${i}].items[${j}].id`);
          assertPositiveInt(line.amount, `listings[${i}].items[${j}].amount`);
        });
        assertPricing(group, `listings[${i}]`, true);
      });
      return client.post(
        "/public/v1/list",
        {
          listings: params.listings.map((group) => ({
            items: group.items.map((line) => ({ id: line.id, amount: line.amount })),
            ...(group.price !== undefined ? { price: group.price } : { price_decay: group.price_decay }),
          })),
        },
        pickRequestOptions(params),
      );
    },

    /** Edits one listing. See {@link ListingEdit} for how `price` and `amount` combine. */
    async editListing(edit: ListingEdit, options?: RequestOptions): Promise<LeanListing> {
      return client.patch("/public/v1/list", editBody(edit, "edit"), pickRequestOptions(options));
    },

    /** Edits up to 50 listings in one call; each succeeds or fails on its own. */
    async editListings(edits: ListingEdit[], options?: RequestOptions): Promise<EditListingsResult> {
      assertLines(edits, "listings");
      return client.patch(
        "/public/v1/list",
        { listings: edits.map((edit, i) => editBody(edit, `listings[${i}]`)) },
        pickRequestOptions(options),
      );
    },

    /** Takes a listing down; its items return to the backpack. */
    async delist(listingId: number, options?: RequestOptions): Promise<DelistResult> {
      assertPositiveInt(listingId, "listing_id");
      return client.post("/public/v1/delist", { listing_id: listingId }, pickRequestOptions(options));
    },

    async delistMany(listingIds: number[], options?: RequestOptions): Promise<DelistManyResult> {
      assertLines(listingIds, "listing_ids");
      listingIds.forEach((id, i) => assertPositiveInt(id, `listing_ids[${i}]`));
      return client.post("/public/v1/delist", { listing_ids: listingIds }, pickRequestOptions(options));
    },

    async myListings(params: MyListingsParams = {}): Promise<MyListingsResponse> {
      assertOneOf(params.status, MY_LISTING_STATUSES, "status");
      return client.get("/public/v1/my-listings", {
        ...pickRequestOptions(params),
        query: {
          page: params.page ?? 1,
          limit: params.limit ?? 100,
          app_id: params.app_id,
          status: params.status,
        },
      });
    },

    async myListingsValue(params: MyListingsValueParams = {}): Promise<MyListingsValue> {
      return client.get("/public/v1/my-listings/value", {
        ...pickRequestOptions(params),
        query: { app_id: params.app_id },
      });
    },

    iterateMyListings(
      params: Omit<MyListingsParams, "page"> = {},
      options: IterateOptions = {},
    ): AsyncGenerator<MyListing, void, undefined> {
      return iteratePages(
        (page) => module.myListings({ ...params, page }),
        (r) => r.listings,
        { minIntervalMs: 1_000, signal: params.signal, ...options },
      );
    },
  };
  return module;
}

export * from "./types.js";
