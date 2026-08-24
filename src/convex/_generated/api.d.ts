/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as appointments from "../appointments.js";
import type * as auth_emailOtp from "../auth/emailOtp.js";
import type * as auth from "../auth.js";
import type * as authProviders from "../authProviders.js";
import type * as connections from "../connections.js";
import type * as crons from "../crons.js";
import type * as email from "../email.js";
import type * as emailDelivery from "../emailDelivery.js";
import type * as emailTemplates from "../emailTemplates.js";
import type * as errors from "../errors.js";
import type * as http from "../http.js";
import type * as invites from "../invites.js";
import type * as messages from "../messages.js";
import type * as notifications from "../notifications.js";
import type * as rateLimit from "../rateLimit.js";
import type * as rooms from "../rooms.js";
import type * as signaling from "../signaling.js";
import type * as users from "../users.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  appointments: typeof appointments;
  "auth/emailOtp": typeof auth_emailOtp;
  auth: typeof auth;
  authProviders: typeof authProviders;
  connections: typeof connections;
  crons: typeof crons;
  email: typeof email;
  emailDelivery: typeof emailDelivery;
  emailTemplates: typeof emailTemplates;
  errors: typeof errors;
  http: typeof http;
  invites: typeof invites;
  messages: typeof messages;
  notifications: typeof notifications;
  rateLimit: typeof rateLimit;
  rooms: typeof rooms;
  signaling: typeof signaling;
  users: typeof users;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
