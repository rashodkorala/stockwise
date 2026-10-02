import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

const schema = a.schema({
  PortfolioPosition: a.customType({
    ticker: a.string().required(),
    units: a.float(),
    marketValue: a.float(),
    currency: a.string(),
  }),

  /** A signed-in user's holdings. Only the owner can read or change it. */
  Portfolio: a
    .model({
      name: a.string().required(),
      baseCurrency: a.string().required(),
      positions: a.ref("PortfolioPosition").array(),
    })
    .authorization((allow) => [allow.owner()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
