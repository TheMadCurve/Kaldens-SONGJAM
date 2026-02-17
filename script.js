const db = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);

// Application state management
class AppState {
  constructor() {
    this.user = null;
    this.userVotes = new Map(); // songId -> points already in database
    this.pendingVotes = new Map(); // songId -> points to be submitted
    this.totalVotesUsed = 0;
    this.isLoading = false;
    this.artists = [];
  }

  reset() {
    this.user = null;
    this.userVotes.clear();
    this.pendingVotes.clear();
    this.totalVotesUsed = 0;
    this.artists = [];
  }

  getRemainingVotes() {
    const pendingTotal = Array.from(this.pendingVotes.values()).reduce((sum, votes) => sum + votes, 0);
    return APP_CONFIG.maxVotesPerUser - this.totalVotesUsed - pendingTotal;
  }

  getVotesForSong(songId) {
    return this.userVotes.get(songId) || 0;
  }

  getPendingVotesForSong(songId) {
    return this.pendingVotes.get(songId) || 0;
  }

  getTotalVotesForSong(songId) {
    return this.getVotesForSong(songId) + this.getPendingVotesForSong(songId);
  }

  canAddVoteForSong(songId) {
    const totalForSong = this.getTotalVotesForSong(songId);
    return this.getRemainingVotes() > 0 && totalForSong < APP_CONFIG.maxVotesPerSong;
  }

  canRemoveVoteForSong(songId) {
    return this.getPendingVotesForSong(songId) > 0;
  }

  addVote(songId) {
    if (!this.canAddVoteForSong(songId)) return false;
    
    const current = this.getPendingVotesForSong(songId);
    this.pendingVotes.set(songId, current + 1);
    return true;
  }

  removeVote(songId) {
    if (!this.canRemoveVoteForSong(songId)) return false;
    
    const current = this.getPendingVotesForSong(songId);
    if (current <= 1) {
      this.pendingVotes.delete(songId);
    } else {
      this.pendingVotes.set(songId, current - 1);
    }
    return true;
  }

  hasPendingVotes() {
    return this.pendingVotes.size > 0;
  }

  getTotalPendingVotes() {
    return Array.from(this.pendingVotes.values()).reduce((sum, votes) => sum + votes, 0);
  }
}

// Initialize app state
const appState = new AppState();

// Cache DOM elements
const elements = {};

// Initialize DOM elements after page load
function initializeElements() {
  elements.loginBtn = document.getElementById('login-btn');
  elements.logoutBtn = document.getElementById('logout-btn');
  elements.votesRemaining = document.getElementById('votes-remaining');
  elements.votesCount = document.querySelector('.votes-count');
  elements.mainContent = document.getElementById('main-content');
  elements.loadingState = document.getElementById('loading-state');
  elements.thankYouModal = document.getElementById('thank-you-modal');
  elements.thankYouClose = document.getElementById('thank-you-close');
  elements.toastContainer = document.getElementById('toast-container');
  elements.submitSection = document.getElementById('submit-section');
  elements.submitVotesBtn = document.getElementById('submit-votes-btn');
  elements.pendingVotesCount = document.getElementById('pending-votes-count');
  
  // Debug logging
  console.log('Elements initialized:', {
    loginBtn: !!elements.loginBtn,
    logoutBtn: !!elements.logoutBtn,
    mainContent: !!elements.mainContent,
    loadingState: !!elements.loadingState,
    votesRemaining: !!elements.votesRemaining
  });
}

// Utility functions
const utils = {
  // Enhanced debounce with immediate option
  debounce(func, wait, immediate = false) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        timeout = null;
        if (!immediate) func(...args);
      };
      const callNow = immediate && !timeout;
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
      if (callNow) func(...args);
    };
  },

  // Sanitize HTML to prevent XSS
  sanitizeHTML(str) {
    const temp = document.createElement('div');
    temp.textContent = str;
    return temp.innerHTML;
  },

  // Format numbers with proper pluralization
  pluralize(count, singular, plural = null) {
    if (count === 1) return singular;
    return plural || `${singular}s`;
  },

  // Retry function for network operations
  async retry(fn, retries = APP_CONFIG.retryAttempts, delay = APP_CONFIG.retryDelay) {
    try {
      return await fn();
    } catch (error) {
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
        return utils.retry(fn, retries - 1, delay * 2);
      }
      throw error;
    }
  },

  // Get Twitch username from provider info
  getTwitchUsername(user) {
    return user?.user_metadata?.preferred_username || 
           user?.user_metadata?.name || 
           'User';
  }
};

// Toast notification system
const toast = {
  show(message, type = 'info', duration = APP_CONFIG.toastDuration) {
    const toastEl = document.createElement('div');
    toastEl.className = `toast toast-${type}`;
    toastEl.textContent = message;
    toastEl.setAttribute('role', 'alert');
    
    elements.toastContainer.appendChild(toastEl);
    
    // Trigger animation
    requestAnimationFrame(() => {
      toastEl.classList.add('show');
    });
    
    // Auto remove
    setTimeout(() => {
      toastEl.classList.remove('show');
      setTimeout(() => toastEl.remove(), 300);
    }, duration);
  },
  
  success(message) { this.show(message, 'success'); },
  error(message) { this.show(message, 'error'); },
  info(message) { this.show(message, 'info'); }
};

// Handle adding a vote
function handleAddVote(artistId) {
  if (appState.addVote(artistId)) {
    updateArtistCard(artistId);
    updateVotesDisplay();
    updateSubmitSection();
  }
}

// Handle removing a vote  
function handleRemoveVote(artistId) {
  if (appState.removeVote(artistId)) {
    updateArtistCard(artistId);
    updateVotesDisplay();
    updateSubmitSection();
  }
}

// Update submit section visibility and info
function updateSubmitSection() {
  const hasPending = appState.hasPendingVotes();
  const pendingCount = appState.getTotalPendingVotes();
  
  if (hasPending) {
    elements.submitSection.style.display = 'block';
    elements.pendingVotesCount.textContent = pendingCount;
    elements.submitVotesBtn.disabled = appState.isLoading;
  } else {
    elements.submitSection.style.display = 'none';
  }
}

// Submit all pending votes
async function submitAllVotes() {
  if (!appState.hasPendingVotes() || appState.isLoading) return;
  
  try {
    appState.isLoading = true;
    elements.submitVotesBtn.disabled = true;
    elements.submitVotesBtn.innerHTML = '<span class="loading-spinner"></span> Submitting...';
    
    const votesToSubmit = Array.from(appState.pendingVotes.entries());
    const errors = [];
    let successCount = 0;
    
    // Submit each vote
    for (const [songId, points] of votesToSubmit) {
      try {
        const existingVotes = appState.getVotesForSong(songId);
        const newTotalVotes = existingVotes + points;
        
        let result;
        if (existingVotes > 0) {
          // Update existing vote
          result = await db
            .from('votes')
            .update({ points: newTotalVotes })
            .eq('user_id', appState.user.id)
            .eq('song_id', songId)
            .select();
        } else {
          // Insert new vote
          result = await db
            .from('votes')
            .insert([{
              id: crypto.randomUUID(),
              user_id: appState.user.id,
              song_id: songId,
              points: points
            }])
            .select();
        }
        
        if (result.error) throw result.error;
        
        // Update local state
        appState.userVotes.set(songId, newTotalVotes);
        appState.totalVotesUsed += points;
        successCount++;
        
      } catch (error) {
        console.error(`Error submitting vote for ${songId}:`, error);
        errors.push({ songId, error });
      }
    }
    
    // Clear pending votes
    appState.pendingVotes.clear();
    
    // Update UI
    updateVotesDisplay();
    updateSubmitSection();
    renderArtists(appState.artists);
    
    // Show result
    if (errors.length === 0) {
      toast.success(`Successfully submitted ${successCount} ${utils.pluralize(successCount, 'vote')}!`);
    } else {
      toast.error(`Failed to submit ${errors.length} ${utils.pluralize(errors.length, 'vote')}. Please try again.`);
    }
    
    // Check if all votes used
    if (appState.getRemainingVotes() === 0) {
      setTimeout(showThankYouModal, 500);
    }
    
  } catch (error) {
    console.error('Submit error:', error);
    toast.error('Failed to submit votes. Please try again.');
  } finally {
    appState.isLoading = false;
    elements.submitVotesBtn.disabled = false;
    elements.submitVotesBtn.innerHTML = 'Submit All Votes';
  }
}

// Event handlers
const handlers = {
  login: utils.debounce(handleLogin, 1000),
  logout: utils.debounce(handleLogout, 1000),
  submitVotes: utils.debounce(submitAllVotes, 500)
};

// Setup all event listeners
function setupEventListeners() {
  // Auth buttons
  elements.loginBtn?.addEventListener('click', handlers.login);
  elements.logoutBtn?.addEventListener('click', handlers.logout);

  // Submit votes button
  elements.submitVotesBtn?.addEventListener('click', handlers.submitVotes);

  // Thank you modal
  elements.thankYouClose?.addEventListener('click', closeThankYouModal);

  // Modal backdrop clicks
  elements.thankYouModal?.addEventListener('click', (e) => {
    if (e.target === elements.thankYouModal) closeThankYouModal();
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (elements.thankYouModal?.style.display === 'flex') closeThankYouModal();
    }
  });

  // Prevent audio from playing simultaneously
  document.addEventListener('play', (e) => {
    const audios = document.querySelectorAll('audio');
    audios.forEach(audio => {
      if (audio !== e.target) audio.pause();
    });
  }, true);

  // Event delegation for vote buttons
  elements.mainContent?.addEventListener('click', (e) => {
    const plusBtn = e.target.closest('.vote-btn-plus');
    const minusBtn = e.target.closest('.vote-btn-minus');
    
    if (plusBtn && !plusBtn.disabled) {
      const artistId = plusBtn.dataset.artistId;
      handleAddVote(artistId);
    } else if (minusBtn && !minusBtn.disabled) {
      const artistId = minusBtn.dataset.artistId;
      handleRemoveVote(artistId);
    }
  });
}

// Authentication handlers
async function handleLogin() {
  if (appState.isLoading) return;
  
  try {
    appState.isLoading = true;
    elements.loginBtn.disabled = true;
    elements.loginBtn.innerHTML = '<span class="loading-spinner"></span> Connecting to Twitch...';

    const { error } = await db.auth.signInWithOAuth({
      provider: 'twitch',
      options: {
        redirectTo: window.location.origin + window.location.pathname,
        scopes: 'user:read:email'
      }
    });

    if (error) throw error;

  } catch (error) {
    console.error('Login error:', error);
    toast.error('Failed to connect to Twitch. Please try again.');
  } finally {
    appState.isLoading = false;
    elements.loginBtn.disabled = false;
    elements.loginBtn.innerHTML = `
      <svg class="twitch-icon" viewBox="0 0 24 24" width="20" height="20">
        <path fill="currentColor" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/>
      </svg>
      Sign in with Twitch
    `;
  }
}

async function handleLogout() {
  if (appState.isLoading) return;
  
  try {
    appState.isLoading = true;
    elements.logoutBtn.disabled = true;
    elements.logoutBtn.innerHTML = '<span class="loading-spinner"></span>';

    const { error } = await db.auth.signOut();
    if (error) throw error;

    toast.info('Logged out successfully');
  } catch (error) {
    console.error('Logout error:', error);
    toast.error('Failed to logout. Please try again.');
  } finally {
    appState.isLoading = false;
    elements.logoutBtn.disabled = false;
    elements.logoutBtn.textContent = 'Logout';
  }
}

// Update UI based on auth state
function updateAuthUI(session) {
  console.log('updateAuthUI called, session:', !!session);
  
  if (session?.user) {
    appState.user = session.user;
    
    // Update UI elements
    elements.loginBtn.style.display = 'none';
    elements.logoutBtn.style.display = 'block';
    elements.votesRemaining.style.display = 'block';
    
    loadUserVotes();
  } else {
    appState.reset();
    
    elements.loginBtn.style.display = 'block';
    elements.logoutBtn.style.display = 'none';
    elements.votesRemaining.style.display = 'none';
  }
  
  loadArtists();
}

// Load user's votes
async function loadUserVotes() {
  if (!appState.user) return;
  
  try {
    const { data: votes, error } = await utils.retry(async () => {
      return await db
        .from('votes')
        .select('song_id, points')
        .eq('user_id', appState.user.id);
    });

    if (error) throw error;

    // Reset and recalculate votes
    appState.userVotes.clear();
    appState.totalVotesUsed = 0;

    votes?.forEach(vote => {
      appState.userVotes.set(vote.song_id, vote.points);
      appState.totalVotesUsed += vote.points;
    });

    updateVotesDisplay();
  } catch (error) {
    console.error('Error loading votes:', error);
    toast.error('Failed to load your votes');
  }
}

// Update votes display
function updateVotesDisplay() {
  const remaining = appState.getRemainingVotes();
  console.log('Updating votes display:', {
    remaining,
    totalUsed: appState.totalVotesUsed,
    userVotes: Array.from(appState.userVotes.entries()),
    pendingVotes: Array.from(appState.pendingVotes.entries())
  });
  
  elements.votesCount.textContent = remaining;
  elements.votesRemaining.classList.toggle('low-votes', remaining <= 4);
  
  // Add class to main content when submit section is visible
  if (appState.hasPendingVotes()) {
    elements.mainContent.classList.add('has-submit');
  } else {
    elements.mainContent.classList.remove('has-submit');
  }
  
  if (remaining === 0 && !appState.hasPendingVotes()) {
    setTimeout(showThankYouModal, 500);
  }
}

// UI state management - UPDATED with better error handling
function showLoadingState(show) {
  console.log('showLoadingState called:', show);
  
  if (elements.loadingState) {
    elements.loadingState.style.display = show ? 'flex' : 'none';
  } else {
    console.warn('Loading state element not found');
  }
}

// Load and display artists - UPDATED with better flow
async function loadArtists() {
  console.log('loadArtists called');
  
  try {
    showLoadingState(true);

    const { data: artists, error } = await utils.retry(async () => {
      console.log('Fetching artists from database...');
      return await db
        .from('artists')
        .select('*');
        // Removed .order('display_name') to shuffle randomly instead
    });

    console.log('Fetch result:', { artistsCount: artists?.length, error });

    if (error) throw error;

    // Shuffle artists randomly for fair visibility
    appState.artists = (artists || []).sort(() => Math.random() - 0.5);
    
    console.log('Artists shuffled randomly');

    if (!appState.user) {
      console.log('No user, showing login prompt');
      showLoginPrompt();
    } else if (appState.artists.length === 0) {
      console.log('No artists found');
      showEmptyState();
    } else {
      console.log('Rendering', appState.artists.length, 'artists');
      renderArtists(appState.artists);
    }
  } catch (error) {
    console.error('Error loading artists:', error);
    showErrorState();
  } finally {
    console.log('Hiding loading state');
    showLoadingState(false);
  }
}

function showLoginPrompt() {
  elements.mainContent.innerHTML = `
    <div class="login-prompt">
      <div class="login-prompt-icon">
        <img src="logo-transparent.png">
      </div>
      <h2>Welcome to Kalden's SONGJAM!</h2>
      <p>Sign in with your Twitch account to vote for your favorites</p>
      
      <div class="how-it-works">
        <h3>How Voting Works:</h3>
        <table>
          <tr><td><img class="number-img" src="images/numba-1.webp" width="30px" height="30px"></td><td class="darules">You get <strong>10 total votes</strong> to distribute</td></tr>
          <tr><td><img class="number-img" src="images/numba-2.webp" width="30px" height="30px"></td><td class="darules">Give up to <strong>4 votes per song</strong></td></tr>
          <tr><td><img class="number-img" src="images/numba-3.webp" width="30px" height="30px"></td><td class="darules">Listen to each song before voting</td></tr>
          <tr><td><img class="crown-img" src="images/crown.webp" width="30px" height="30px"></td><td class="darules">Help your favorite artists win!</td></tr>
        </table>
      </div>
      
      <button onclick="handlers.login()" class="login-prompt-btn">
        <svg class="twitch-icon" viewBox="0 0 24 24" width="24" height="24">
          <path fill="currentColor" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/>
        </svg>
        Sign in with Twitch to Vote
      </button>
      
      <p class="login-note">Safe & secure - we only access your public Twitch profile</p>
    </div>
  `;
}

function showEmptyState() {
  elements.mainContent.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">🎤</div>
      <h2>No Artists Yet</h2>
      <p>Check back soon for amazing music!</p>
    </div>
  `;
}

function showErrorState() {
  elements.mainContent.innerHTML = `
    <div class="error-state">
      <div class="error-state-icon">⚠️</div>
      <h2>Something went wrong</h2>
      <p>We couldn't load the artists. Please try again.</p>
      <button onclick="location.reload()" class="retry-btn">Retry</button>
    </div>
  `;
}

// Render artist cards
function renderArtists(artists) {
  const grid = document.createElement('div');
  grid.className = 'artist-grid';

  artists.forEach(artist => {
    const card = createArtistCard(artist);
    grid.appendChild(card);
  });

  elements.mainContent.innerHTML = '';
  elements.mainContent.appendChild(grid);
}

// Create individual artist card
function createArtistCard(artist) {
  const card = document.createElement('div');
  card.className = 'artist-card';
  card.dataset.artistId = artist.song_id;
  
  const existingVotes = appState.getVotesForSong(artist.song_id);
  const pendingVotes = appState.getPendingVotesForSong(artist.song_id);
  const totalVotes = existingVotes + pendingVotes;
  const canAdd = appState.canAddVoteForSong(artist.song_id);
  const canRemove = appState.canRemoveVoteForSong(artist.song_id);
  
  // Get song URL from Supabase storage
  const songURL = db.storage
    .from('songs')
    .getPublicUrl(`${artist.twitch_username}.mp3`).data.publicUrl;
  
  // Create card content
  const artistImage = artist.image_url || 'images/default-artist.png';
  const displayName = utils.sanitizeHTML(artist.display_name);
  const songTitle = artist.song_title ? utils.sanitizeHTML(artist.song_title) : '';
  
  card.innerHTML = `
    <div class="artist-image-container">
      <a href="${artist.twitch_url || '#'}" target="_blank" rel="noopener noreferrer" class="artist-link">
        <img src="${artistImage}" 
             alt="${displayName}" 
             class="artist-img" 
             loading="lazy"
             onerror="this.src='images/default-artist.png'">
        <div class="artist-overlay">
          <svg class="twitch-icon" viewBox="0 0 24 24" width="24" height="24">
            <path fill="currentColor" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/>
          </svg>
          <span>View on Twitch</span>
        </div>
      </a>
    </div>
    
    <div class="artist-info">
      <h3 class="artist-name">${displayName}</h3>
      ${songTitle ? `<p class="song-title">"${songTitle}"</p>` : ''}
    </div>
    
    <div class="audio-container">
      <audio controls class="artist-audio" preload="none">
        <source src="${songURL}" type="audio/mpeg">
        Your browser does not support the audio element.
      </audio>
    </div>
    
    <div class="vote-section">
      ${existingVotes > 0 ? `
        <div class="existing-votes">
          Previously gave ${existingVotes} ${utils.pluralize(existingVotes, 'vote')}
        </div>
      ` : ''}
      
      <div class="vote-controls">
        <button 
          class="vote-btn vote-btn-minus" 
          data-artist-id="${artist.song_id}"
          ${!canRemove ? 'disabled' : ''}
          aria-label="Remove vote from ${displayName}"
        >
          −
        </button>
        
        <div class="vote-display">
          <span class="vote-count ${pendingVotes > 0 ? 'has-pending' : ''}">${totalVotes}</span>
          ${pendingVotes > 0 ? `<span class="pending-indicator">+${pendingVotes}</span>` : ''}
        </div>
        
        <button 
          class="vote-btn vote-btn-plus" 
          data-artist-id="${artist.song_id}"
          ${!canAdd ? 'disabled' : ''}
          aria-label="Add vote to ${displayName}"
        >
          +
        </button>
      </div>
      
      ${totalVotes >= APP_CONFIG.maxVotesPerSong ? 
        '<div class="max-votes-message">Max votes reached</div>' : 
        ''
      }
    </div>
  `;
  
  return card;
}

// Update a specific artist card without reloading all
function updateArtistCard(artistId) {
  const card = document.querySelector(`[data-artist-id="${artistId}"]`);
  if (!card) return;
  
  const artist = appState.artists.find(a => a.song_id === artistId);
  if (!artist) return;
  
  const newCard = createArtistCard(artist);
  card.replaceWith(newCard);
}

// Modal functions
function showThankYouModal() {
  elements.thankYouModal.style.display = 'flex';
  elements.thankYouModal.setAttribute('aria-hidden', 'false');
  elements.thankYouClose.focus();
}

function closeThankYouModal() {
  elements.thankYouModal.style.display = 'none';
  elements.thankYouModal.setAttribute('aria-hidden', 'true');
}

// Make functions globally accessible
window.handlers = handlers;

// Auth state listener
db.auth.onAuthStateChange((event, session) => {
  console.log('Auth state changed:', event);
  updateAuthUI(session);
});

// Initialize application
async function init() {
  console.log('=== Initializing Application ===');
  
  try {
    initializeElements();
    setupEventListeners();
    
    // Check for existing session
    const { data: { session }, error } = await db.auth.getSession();
    if (error) throw error;
    
    console.log('Initial session:', !!session);
    updateAuthUI(session);
  } catch (error) {
    console.error('Initialization error:', error);
    toast.error('Failed to initialize. Please refresh the page.');
  }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Handle page visibility for auto-refresh
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && appState.user) {
    loadUserVotes(); // Refresh votes when page becomes visible
  }
});
