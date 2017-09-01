const { MetroHash128 } = require('metrohash')
const SEED = 0

function createHash () {
  // Be aware: the hash object created with this particular implementation
  // has hash.digest() method with no args, means it always
  // returns a 'hex' formatted digest.
  return new MetroHash128(SEED)
}

module.exports = createHash
