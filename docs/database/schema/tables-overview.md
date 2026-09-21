# Tables overview — storygroove-be

MongoDB collections correspond to **`mongoose.model`** definitions in `models/`.

| Mongoose model | File | Typical purpose |
|----------------|------|-----------------|
| User | `user.js` | Accounts, JWT, Stripe customer, quotas |
| Token | `token.js` | Reset tokens |
| Novel | `novelModel.js` | Book project aggregate root |
| Character | `characterModel.js` | Cast |
| Notes | `notesModel.js` | Novel notes |
| UserContent | `userContentModel.js` | Outline / scene authoring slots |
| StoryResponse | `storyResponseModel.js` | Persisted generations |
| Thread | `threadModel.js` | Chat threads |
| Message | `messageModel.js` | Chat messages |
| EllisSceneReview | `ellisSceneReviewModel.js` | Ellis analyses |
| OliviaSceneSuggestion | `oliviaSceneSuggestionModel.js` | Scene Design output |
| ReviewPillar | `reviewPillarModel.js` | Review taxonomy |
| Image | `image.js` | Image metadata |
| Subscriber | `subscriberModel.js` | Live Stripe subscriber |
| Subscription | `subscriptionModel.js` | Plan catalog |
| Invoice | `invoicesModel.js` | Stripe invoices mirror |
| UserAgent | `userAgentModel.js` | Assistants-era agents |
| AgentPrompt | `agentPromptModel.js` | Admin-managed prompts |
| SimoneConfig | `simoneConfigModel.js` | Global Simone secrets/config |
| MethodologyRule | `methodologyRuleModel.js` | Methodology rules |
| PromptTemplate | `promptTemplateModel.js` | Methodology Markdown templates |
| GenreOverlay | `genreOverlayModel.js` | Genre-specific overlays |
| StoryState | `storyStateModel.js` | Olivia memory aggregate |
| SceneMemory | `sceneMemoryModel.js` | Scene-scoped narrative memory |
| EpisodicEvent | `episodicEventModel.js` | Ranked episodic facts |
| RelationshipEdge | `relationshipEdgeModel.js` | Character relationship edges |
| ActiveSceneState | `activeSceneStateModel.js` | Editor focus marker |
| ConversationCursor | `conversationCursorModel.js` | Conversation offsets |
| CharacterState | `characterStateModel.js` | Character synopsis state |
| SceneCheckpoint | `sceneCheckpointModel.js` | Draft checkpoints |
| ApiUsageLog | `apiUsageLogModel.js` | Usage telemetry |
| ApiUsageSettings | `apiUsageSettingsModel.js` | Global caps |
| RateLimitEvent | `rateLimitEventModel.js` | Rate limit occurrences |
| ActivityLog | `activityLogModel.js` | Moderation / audit feed |
