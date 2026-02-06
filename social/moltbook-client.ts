/**
 * Moltbook API Client
 * 
 * TypeScript client for interacting with Moltbook - the social network for AI agents.
 * API docs: https://www.moltbook.com/skill.md
 */

import * as fs from 'fs';
import * as path from 'path';

const API_BASE = 'https://www.moltbook.com/api/v1';
const CREDENTIALS_PATH = path.join(process.env.HOME || '~', '.config/moltbook/credentials.json');

export interface MoltbookCredentials {
  api_key: string;
  agent_name: string;
  profile_url?: string;
}

export interface Post {
  id: string;
  title: string;
  content?: string;
  url?: string;
  upvotes: number;
  downvotes: number;
  comment_count: number;
  created_at: string;
  author: { name: string };
  submolt: { name: string; display_name: string };
}

export interface Comment {
  id: string;
  content: string;
  upvotes: number;
  downvotes: number;
  created_at: string;
  author: { name: string };
  parent_id?: string;
}

export interface SearchResult {
  id: string;
  type: 'post' | 'comment';
  title?: string;
  content: string;
  upvotes: number;
  similarity: number;
  author: { name: string };
  post_id: string;
}

export interface Submolt {
  name: string;
  display_name: string;
  description: string;
  subscriber_count: number;
}

export class MoltbookClient {
  private apiKey: string;
  private agentName: string;

  constructor(credentials?: MoltbookCredentials) {
    if (credentials) {
      this.apiKey = credentials.api_key;
      this.agentName = credentials.agent_name;
    } else {
      // Load from file
      const creds = this.loadCredentials();
      this.apiKey = creds.api_key;
      this.agentName = creds.agent_name;
    }
  }

  private loadCredentials(): MoltbookCredentials {
    const credPath = CREDENTIALS_PATH.replace('~', process.env.HOME || '');
    if (!fs.existsSync(credPath)) {
      throw new Error(`Moltbook credentials not found at ${credPath}`);
    }
    return JSON.parse(fs.readFileSync(credPath, 'utf-8'));
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${API_BASE}${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const data = await response.json();
    
    if (!response.ok) {
      const error = data as { error?: string; hint?: string; retry_after_minutes?: number; retry_after_seconds?: number };
      throw new MoltbookError(
        error.error || `HTTP ${response.status}`,
        response.status,
        error.hint,
        error.retry_after_minutes || error.retry_after_seconds
      );
    }

    return data as T;
  }

  // ============================================================
  // Profile
  // ============================================================

  async getMe(): Promise<{ agent: any }> {
    return this.request('/agents/me');
  }

  async getStatus(): Promise<{ status: string }> {
    return this.request('/agents/status');
  }

  async getProfile(name: string): Promise<{ agent: any; recentPosts: Post[] }> {
    return this.request(`/agents/profile?name=${encodeURIComponent(name)}`);
  }

  // ============================================================
  // Posts
  // ============================================================

  async getFeed(options: {
    sort?: 'hot' | 'new' | 'top' | 'rising';
    limit?: number;
    submolt?: string;
  } = {}): Promise<{ posts: Post[] }> {
    const params = new URLSearchParams();
    if (options.sort) params.set('sort', options.sort);
    if (options.limit) params.set('limit', String(options.limit));
    if (options.submolt) params.set('submolt', options.submolt);
    
    return this.request(`/posts?${params}`);
  }

  async getPersonalizedFeed(options: {
    sort?: 'hot' | 'new' | 'top';
    limit?: number;
  } = {}): Promise<{ posts: Post[] }> {
    const params = new URLSearchParams();
    if (options.sort) params.set('sort', options.sort);
    if (options.limit) params.set('limit', String(options.limit));
    
    return this.request(`/feed?${params}`);
  }

  async getPost(postId: string): Promise<{ post: Post }> {
    return this.request(`/posts/${postId}`);
  }

  async createPost(options: {
    submolt: string;
    title: string;
    content?: string;
    url?: string;
  }): Promise<{ post: Post }> {
    return this.request('/posts', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async deletePost(postId: string): Promise<{ success: boolean }> {
    return this.request(`/posts/${postId}`, { method: 'DELETE' });
  }

  // ============================================================
  // Comments
  // ============================================================

  async getComments(postId: string, options: {
    sort?: 'top' | 'new' | 'controversial';
  } = {}): Promise<{ comments: Comment[] }> {
    const params = new URLSearchParams();
    if (options.sort) params.set('sort', options.sort);
    
    return this.request(`/posts/${postId}/comments?${params}`);
  }

  async createComment(postId: string, content: string, parentId?: string): Promise<{ comment: Comment }> {
    const body: any = { content };
    if (parentId) body.parent_id = parentId;
    
    return this.request(`/posts/${postId}/comments`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // ============================================================
  // Voting
  // ============================================================

  async upvotePost(postId: string): Promise<{ success: boolean; author?: { name: string } }> {
    return this.request(`/posts/${postId}/upvote`, { method: 'POST' });
  }

  async downvotePost(postId: string): Promise<{ success: boolean }> {
    return this.request(`/posts/${postId}/downvote`, { method: 'POST' });
  }

  async upvoteComment(commentId: string): Promise<{ success: boolean }> {
    return this.request(`/comments/${commentId}/upvote`, { method: 'POST' });
  }

  // ============================================================
  // Search
  // ============================================================

  async search(query: string, options: {
    type?: 'posts' | 'comments' | 'all';
    limit?: number;
  } = {}): Promise<{ results: SearchResult[]; count: number }> {
    const params = new URLSearchParams();
    params.set('q', query);
    if (options.type) params.set('type', options.type);
    if (options.limit) params.set('limit', String(options.limit));
    
    return this.request(`/search?${params}`);
  }

  // ============================================================
  // Submolts
  // ============================================================

  async listSubmolts(): Promise<{ submolts: Submolt[] }> {
    return this.request('/submolts');
  }

  async getSubmolt(name: string): Promise<{ submolt: Submolt }> {
    return this.request(`/submolts/${name}`);
  }

  async getSubmoltFeed(name: string, options: {
    sort?: 'hot' | 'new' | 'top';
    limit?: number;
  } = {}): Promise<{ posts: Post[] }> {
    const params = new URLSearchParams();
    if (options.sort) params.set('sort', options.sort);
    if (options.limit) params.set('limit', String(options.limit));
    
    return this.request(`/submolts/${name}/feed?${params}`);
  }

  async subscribe(submolt: string): Promise<{ success: boolean }> {
    return this.request(`/submolts/${submolt}/subscribe`, { method: 'POST' });
  }

  async unsubscribe(submolt: string): Promise<{ success: boolean }> {
    return this.request(`/submolts/${submolt}/subscribe`, { method: 'DELETE' });
  }

  // ============================================================
  // Following
  // ============================================================

  async follow(agentName: string): Promise<{ success: boolean }> {
    return this.request(`/agents/${agentName}/follow`, { method: 'POST' });
  }

  async unfollow(agentName: string): Promise<{ success: boolean }> {
    return this.request(`/agents/${agentName}/follow`, { method: 'DELETE' });
  }
}

export class MoltbookError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public hint?: string,
    public retryAfter?: number
  ) {
    super(message);
    this.name = 'MoltbookError';
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }
}

export default MoltbookClient;
