# Dev Setup

## Run `docker compose create` and `docker compose start`

The included docker compose file will start a MongoDB server, along with Mongo Express for viewing and editing the DB.

Mongo Express can be found at `localhost:8081` once started.

## .env

Create a `.env` file, and populate it with a copy from production.

Replace the following:
```
MONGO_URI='mongodb://root:example@localhost:27017'
MONGODB_NAME=dev
CLIENT_URL="http://localhost:3000"
HOST_LINK="http://localhost:8086"
SERVER_URL="http://localhost:8086/"
DASHBOARD_URL="http://localhost:3000/dashboard"
CANCEL_URL="http://localhost:3000/subscriptionfailed"
```

## Running

You can run the backend simply by running `node index.js`

## DB seeding

While running both the backend and frontend, a user can sign up via the frontend, but won't be able to choose any plans, since there are none.

After signing up, you can seed the DB with a subscription plan and a subscriber using Mongo Express.

There should be a `dev` database with some empty collections post running, and a user document post signup.

You can add the following document to `subscriptions`:
```
{
  _id: ObjectId(),
  planId: '',
  priceId: 'fake_price_id',
  name: 'Dev',
  currency: 'cad',
  amount: 0,
  interval: 'month',
  description: 'Dev',
  subscription_status: true,
  aiBgRemoval: true,
  aiPhotoBackgorundGenerator: 10000,
  aiVideos: 1000,
  photoEditing: true,
  templateOptions: true,
  aiDescriptionGeneratorShopify: true,
  aiCaptionSocialShare: true,
  autoSharing: true,
  support: 'email',
  isdeleted: false,
  freeTrialDays: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  __v: 0
}
```

And the following document to `subscribers`:
Note: Fill in the various `%user_<>%` with values from your user document under the `user` collection
```
{
  _id: ObjectId(),
  userid: ObjectId("%user_id%"),
  planId: 'fake_price_id',
  name: '%user_name%',
  email: '%user_email%',
  subscription_status: 'active',
  customer_id: '',
  subscription_id: '',
  purchased_on: new Date(),
  subscribe_from_shopify: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  __v: 0
}
```

`planId`/`priceId`/`customer_id`/`subscription_id` are all from Stripe, and can be left blank as part of bypassing Stripe payments in development. Also note that `planId` and `priceId` are sometimes mixed in the current data model.

## Olivia methodology (admin)

Olivia craft rules, per-scene templates, and genre overlays are managed via **Methodology Admin** (`/api/assistant/methodology/*`) and injected into chat instructions via `methodologyService`. Persona/workflow text lives in Agent Prompts (`/api/assistant/agent/prompt`).

1. **Agent Prompts (admin + runtime)** — sync Olivia persona prompts to Mongo:  
   `node scripts/syncOliviaAgentPromptsFromRepo.mjs`  
   Sources: `olivia-editor.txt`, `olivia-scene.txt`, `olivia-coaching.txt` (repo root).

2. **Methodology rules / templates / overlays** (craft injection, not full persona):  
   `node scripts/seedMethodologyFromJson.js`  
   Optional: `--only=templates`, `--audit-constants`.  
   Legacy `--apply-agentprompt-slim` overlaps with (1) for editor/scene; prefer the sync script above.
