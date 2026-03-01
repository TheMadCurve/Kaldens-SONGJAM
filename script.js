// Award Show Configuration
const AWARD_SHOW_CONFIG = {
  dateTime: '2026-03-07T11:00:00Z', // ISO format in UTC
  twitchChannel: 'kalden_berg'
};

// Initialize the page
function init() {
  console.log('Initializing award show page...');
  displayAwardShowInfo();
}

// Display the award show information
function displayAwardShowInfo() {
  const mainContent = document.getElementById('main-content');
  
  if (!mainContent) {
    console.error('Main content element not found');
    return;
  }
  
  // Parse the award show date
  const awardShowDate = new Date(AWARD_SHOW_CONFIG.dateTime);
  const twitchUrl = `https://twitch.tv/${AWARD_SHOW_CONFIG.twitchChannel}`;
  
  // Format date and time for user's local timezone
  const dateOptions = { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  };
  
  const timeOptions = { 
    hour: 'numeric', 
    minute: '2-digit', 
    timeZoneName: 'short' 
  };
  
  const localDate = awardShowDate.toLocaleDateString(undefined, dateOptions);
  const localTime = awardShowDate.toLocaleTimeString(undefined, timeOptions);
  
  // Create the page content
  mainContent.innerHTML = `
    <div class="login-prompt">
      <div class="login-prompt-icon">
        <img src="logo-transparent.webp" alt="Kalden's SONGJAM">
      </div>
      
      <h2>Thank You for Voting!</h2>
      <p class="thank-you-message">
        Voting for Kalden's SONGJAM has ended.
        <br>
        Thank you to everyone who participated and supported our amazing artists!
      </p>
      
      <div class="award-show-info">
        <h3>Join Us for the Award Show!</h3>
        <p class="award-show-description">
          Tune in to see the results live and celebrate our talented artists!
        </p>
        
        <div class="stream-details">
          <div class="stream-detail-item">
            <div class="detail-content">
              <strong>Date and Time</strong>
              <p>${localDate} at ${localTime}</p>
            </div>
          </div>
      </div>
    <a href="${twitchUrl}" target="_blank" rel="noopener noreferrer" class="watch-stream-btn">
    <svg class="twitch-icon" viewBox="0 0 24 24" width="24" height="24">
      <path fill="currentColor" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/>
    </svg>
    Watch on Twitch
      </a>
      
      <p class="closing-message">See you at the Award Show!</p>
    </div>
  `;
  
  console.log('Award show page loaded successfully');
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
