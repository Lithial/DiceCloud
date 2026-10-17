// meteor test doesn't load server/main.js, so collection2 has to be loaded here for attachSchema to exist.
// The 0- prefix makes it load before the other test files.
import 'meteor/aldeed:collection2/static';
