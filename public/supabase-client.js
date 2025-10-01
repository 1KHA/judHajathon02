// Initialize Supabase client for frontend use
const SUPABASE_URL = window.SUPABASE_URL || 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';

// Create Supabase client
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Real-time subscription manager
class RealtimeManager {
  constructor() {
    this.subscriptions = new Map();
  }

  // Subscribe to session events
  subscribeToSession(sessionId, callbacks) {
    const channelName = `session:${sessionId}`;
    
    if (this.subscriptions.has(channelName)) {
      this.unsubscribe(channelName);
    }

    const channel = supabaseClient
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'SessionEvent',
          filter: `sessionId=eq.${sessionId}`
        },
        (payload) => {
          const event = payload.new;
          console.log('Session event:', event);
          
          // Call appropriate callback based on event type
          switch (event.eventType) {
            case 'session_created':
              callbacks.onSessionCreated?.(event.eventData);
              break;
            case 'questions_started':
              callbacks.onQuestionsStarted?.(event.eventData);
              break;
            case 'team_changed':
              callbacks.onTeamChanged?.(event.eventData);
              break;
            case 'answer_submitted':
              callbacks.onAnswerSubmitted?.(event.eventData);
              break;
            case 'leaderboard_updated':
              callbacks.onLeaderboardUpdated?.(event.eventData);
              break;
            default:
              callbacks.onEvent?.(event);
          }
        }
      )
      .subscribe();

    this.subscriptions.set(channelName, channel);
    return channel;
  }

  // Subscribe to judge status updates
  subscribeToJudges(sessionId, callback) {
    const channelName = `judges:${sessionId}`;
    
    if (this.subscriptions.has(channelName)) {
      this.unsubscribe(channelName);
    }

    const channel = supabaseClient
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'Judge',
          filter: `sessionId=eq.${sessionId}`
        },
        (payload) => {
          callback(payload);
        }
      )
      .subscribe();

    this.subscriptions.set(channelName, channel);
    return channel;
  }

  // Subscribe to session state changes
  subscribeToSessionState(sessionId, callback) {
    const channelName = `session-state:${sessionId}`;
    
    if (this.subscriptions.has(channelName)) {
      this.unsubscribe(channelName);
    }

    const channel = supabaseClient
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'Session',
          filter: `sessionId=eq.${sessionId}`
        },
        (payload) => {
          callback(payload.new);
        }
      )
      .subscribe();

    this.subscriptions.set(channelName, channel);
    return channel;
  }

  // Unsubscribe from a channel
  unsubscribe(channelName) {
    const channel = this.subscriptions.get(channelName);
    if (channel) {
      supabaseClient.removeChannel(channel);
      this.subscriptions.delete(channelName);
    }
  }

  // Unsubscribe from all channels
  unsubscribeAll() {
    for (const [name, channel] of this.subscriptions) {
      supabaseClient.removeChannel(channel);
    }
    this.subscriptions.clear();
  }
}

// Create a global instance
window.realtimeManager = new RealtimeManager();

// API helper functions
const api = {
  // Base URL for API calls
  baseURL: window.location.origin,

  // Helper to make API calls
  async request(url, options = {}) {
    const response = await fetch(`${this.baseURL}${url}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  },

  // Host APIs
  async getHostInitData() {
    return this.request('/api/host/init');
  },

  async createSession(teamNames) {
    return this.request('/api/session/create', {
      method: 'POST',
      body: JSON.stringify({ teamNames })
    });
  },

  async startQuestions(sessionId, questionIds, hostToken) {
    return this.request(`/api/session/${sessionId}/start-questions`, {
      method: 'POST',
      body: JSON.stringify({ questionIds, hostToken })
    });
  },

  async changeTeam(sessionId, direction, hostToken) {
    return this.request(`/api/session/${sessionId}/change-team`, {
      method: 'POST',
      body: JSON.stringify({ direction, hostToken })
    });
  },

  // Judge APIs
  async joinAsJudge(pin, name) {
    return this.request('/api/judge/join', {
      method: 'POST',
      body: JSON.stringify({ pin, name })
    });
  },

  async submitAnswer(sessionId, judgeToken, answer, questionIndex) {
    return this.request('/api/answer/submit', {
      method: 'POST',
      body: JSON.stringify({ sessionId, judgeToken, answer, questionIndex })
    });
  },

  async submitFinalAnswers(sessionId, judgeToken, teamId, answers) {
    return this.request('/api/answer/submit-final', {
      method: 'POST',
      body: JSON.stringify({ sessionId, judgeToken, teamId, answers })
    });
  },

  // Common APIs
  async getSessionState(sessionId) {
    return this.request(`/api/session/${sessionId}/state`);
  },

  async getLeaderboard(sessionId) {
    return this.request(`/api/session/${sessionId}/leaderboard`);
  },

  async saveQuestions(questions, totalPoints, bankName) {
    return this.request('/api/questions/save', {
      method: 'POST',
      body: JSON.stringify({ questions, totalPoints, bankName })
    });
  }
};

// Export for use
window.api = api;
