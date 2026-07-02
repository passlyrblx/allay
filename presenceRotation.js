const { ActivityType, PresenceUpdateStatus } = require('discord.js');

const THREE_HOURS_IN_MS = 3 * 60 * 60 * 1000;

const BEST_FRIEND_NAME = 'no friends yet 💔';

const PRESENCE_ACTIVITIES = {
  watching: [
    'OVER EPICADE',
    `MY BEST FRIEND (${BEST_FRIEND_NAME})`,
    'THE COMMUNITY GROW',
  ],
  listening: [
    `MY BEST FRIEND (${BEST_FRIEND_NAME})`,
    'THE COMMUNITY',
    'LOFI BEATS',
  ],
  playing: [
    'MINECRAFT SMP',
    'WITH THE COMMUNITY',
    'EPICADE ADVENTURES',
  ],
};

const PRESENCE_ROTATION = [
  { name: 'Watching', type: ActivityType.Watching, activities: PRESENCE_ACTIVITIES.watching },
  { name: 'Listening', type: ActivityType.Listening, activities: PRESENCE_ACTIVITIES.listening },
  { name: 'Playing', type: ActivityType.Playing, activities: PRESENCE_ACTIVITIES.playing },
];

let currentCategoryIndex = 0;
let presenceRotationTimer = null;

function chooseActivity(activities) {
  return activities[Math.floor(Math.random() * activities.length)];
}

function rotatePresence(client) {
  const category = PRESENCE_ROTATION[currentCategoryIndex];
  const activityName = chooseActivity(category.activities);

  client.user.setPresence({
    status: PresenceUpdateStatus.Online,
    activities: [{ name: activityName, type: category.type }],
  });

  console.log(`[presence] Set Online presence: ${category.name} ${activityName}`);
  currentCategoryIndex = (currentCategoryIndex + 1) % PRESENCE_ROTATION.length;
}

function startPresenceRotation(client) {
  if (presenceRotationTimer) {
    return;
  }

  rotatePresence(client);
  presenceRotationTimer = setInterval(() => rotatePresence(client), THREE_HOURS_IN_MS);
}

module.exports = {
  PRESENCE_ACTIVITIES,
  startPresenceRotation,
};
