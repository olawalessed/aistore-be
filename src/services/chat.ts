import { UpstashHelper } from "./upstash";
import { parseUserIntent, parseUserIntentHybrid } from "../helpers/ai-chat";
import { SearchService } from "./search";
import { generateAIResponse } from "../helpers/ai-chat";
import { EnvBindings } from "../bindings";

export interface CompactIntent {
  c?: string; // category
  b?: number; // budget_max
  col?: string; // color
  loc?: { city?: string; country?: string }; // location
}

export interface CompactChatState {
  m: "discovery" | "decision"; // mode
  i: CompactIntent; // intent
  lr: string; // last_results_hash
  sp: string[]; // selected_product_ids
  t: number; // updated_at
}

export interface ChatInitRequest {
  initial_message?: string;
}

export interface ChatInitResponse {
  conversation_id: string;
  assistant_message: string;
  products: any[];
  suggestions: string[];
  mode: "discovery" | "decision";
  created_at: number;
}

export interface ChatMessageRequest {
  conversation_id: string;
  message: string;
}

export interface ChatMessageResponse {
  assistant_message: string;
  products: any[];
  suggestions: string[];
  mode: "discovery" | "decision";
  timestamp: number;
}

export interface ChatConversationResponse {
  conversation_id: string;
  created_at: number;
  mode: "discovery" | "decision";
  intent: CompactIntent;
  selected_product_ids: string[];
  can_continue: boolean;
  last_activity: number;
}

export class ChatService {
  private env: EnvBindings;
  private upstash: UpstashHelper;

  constructor(env: EnvBindings) {
    this.env = env;
    this.upstash = new UpstashHelper(env);
  }

  async initChat(request: ChatInitRequest): Promise<ChatInitResponse> {
    const conversationId = this.generateChatId();
    const now = Date.now();

    // Parse intent from initial message
    const intent = request.initial_message
      ? parseUserIntentHybrid(request.initial_message, this.env)
      : {};

    // Search for products based on intent
    const searchResults = await SearchService.search(this.env, {
      query: request.initial_message || "",
      intent,
      resultLimit: 5,
    });

    // Generate AI response
    const aiResponse = await generateAIResponse(
      request.initial_message || "Hi, I'm here to help you find products",
      searchResults,
      [], // No conversation history on init
      this.env.OPENROUTER_API_KEY
    );

    // Create compact chat state
    const compactState: CompactChatState = {
      m: "discovery",
      i: this.compactIntent(intent),
      lr: this.resultsHash(searchResults),
      sp: [],
      t: now,
    };

    // Store in Upstash with 24-hour TTL
    const redis = this.upstash.getRedisClient();
    await redis.setex(
      `chat:${conversationId}`,
      86400, // 24 hours
      JSON.stringify(compactState)
    );

    return {
      conversation_id: conversationId,
      assistant_message: aiResponse.message,
      products: searchResults.results,
      suggestions: aiResponse.suggestions || [],
      mode: "discovery",
      created_at: now,
    };
  }

  async sendMessage(request: ChatMessageRequest): Promise<ChatMessageResponse> {
    const now = Date.now();

    // Retrieve existing conversation state
    const existingState = await this.getConversationState(
      request.conversation_id
    );
    if (!existingState) {
      throw new Error("Conversation not found or expired");
    }

    // Parse new intent and detect mode shifts
    const newIntent = parseUserIntent(request.message);
    const updatedMode = this.detectModeShift(
      existingState,
      newIntent,
      request.message
    );

    // Search with updated intent
    const searchResults = await SearchService.search(this.env, {
      query: request.message,
      intent: newIntent,
      resultLimit: 5,
    });

    // Generate AI response with context
    const aiResponse = await generateAIResponse(
      request.message,
      searchResults,
      [], // TODO: Add conversation history if needed
      this.env.OPENROUTER_API_KEY
    );

    // Update compact state
    const updatedState: CompactChatState = {
      ...existingState,
      m: updatedMode,
      i: this.compactIntent(newIntent),
      lr: this.resultsHash(searchResults),
      t: now,
    };

    // Handle product selection in decision mode
    if (updatedMode === "decision") {
      const selectedIds = this.extractSelectedProducts(
        request.message,
        searchResults
      );
      updatedState.sp = selectedIds;
    }

    // Store updated state
    const redis = this.upstash.getRedisClient();
    await redis.setex(
      `chat:${request.conversation_id}`,
      86400,
      JSON.stringify(updatedState)
    );

    return {
      assistant_message: aiResponse.message,
      products: searchResults.results,
      suggestions: aiResponse.suggestions || [],
      mode: updatedMode,
      timestamp: now,
    };
  }

  async getConversation(
    conversationId: string
  ): Promise<ChatConversationResponse | null> {
    const state = await this.getConversationState(conversationId);
    if (!state) {
      return null;
    }

    return {
      conversation_id: conversationId,
      created_at: state.t,
      mode: state.m,
      intent: state.i,
      selected_product_ids: state.sp,
      can_continue: true, // TODO: Add business logic for expiration
      last_activity: state.t,
    };
  }

  private async getConversationState(
    conversationId: string
  ): Promise<CompactChatState | null> {
    try {
      const redis = this.upstash.getRedisClient();
      const result = await redis.get(`chat:${conversationId}`);
      return result ? JSON.parse(result as string) : null;
    } catch (error) {
      console.error(`Failed to get conversation ${conversationId}:`, error);
      return null;
    }
  }

  private generateChatId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `conv_${timestamp}_${random}`;
  }

  private compactIntent(intent: any): CompactIntent {
    const compact: CompactIntent = {};

    if (intent.category) compact.c = intent.category;
    if (intent.budget_max) compact.b = intent.budget_max;
    if (intent.color) compact.col = intent.color;
    if (intent.location) compact.loc = intent.location;

    return compact;
  }

  private resultsHash(searchResults: any): string {
    // Create a simple hash from search results for cache invalidation
    const key = JSON.stringify({
      result_count: searchResults.results.length,
      top_ids: searchResults.results.slice(0, 3).map((r: any) => r.product.id),
    });
    return btoa(key)
      .replace(/[^a-zA-Z0-9]/g, "")
      .substring(0, 12);
  }

  private detectModeShift(
    existingState: CompactChatState,
    newIntent: any,
    message: string
  ): "discovery" | "decision" {
    // Decision mode indicators
    const decisionKeywords = [
      "add to cart",
      "buy",
      "purchase",
      "select",
      "choose",
      "want this",
      "take this",
    ];
    const hasDecisionKeywords = decisionKeywords.some((keyword) =>
      message.toLowerCase().includes(keyword)
    );

    if (hasDecisionKeywords) {
      return "decision";
    }

    // Stay in decision mode if products are already selected
    if (existingState.m === "decision" && existingState.sp.length > 0) {
      return "decision";
    }

    return "discovery";
  }

  private extractSelectedProducts(
    message: string,
    searchResults: any
  ): string[] {
    const selectedIds: string[] = [];

    // Simple extraction: look for "first one", "second one", "the X one", etc.
    const positionRegex = /(\d+)(?:st|nd|rd|th)?\s+one/i;
    const match = message.match(positionRegex);

    if (match) {
      const position = parseInt(match[1]) - 1; // Convert to 0-based index
      if (position >= 0 && position < searchResults.results.length) {
        selectedIds.push(searchResults.results[position].product.id);
      }
    }

    // Also check for "this one" (assuming context of last mentioned product)
    if (
      message.toLowerCase().includes("this one") &&
      searchResults.results.length > 0
    ) {
      selectedIds.push(searchResults.results[0].product.id);
    }

    return selectedIds;
  }
}
