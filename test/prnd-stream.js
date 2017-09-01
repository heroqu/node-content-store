const { Random } = require('@offirmo/random')
const StreamGenerator = require('stream-generator')

module.exports = PseudoRandomStream

/**
* Reproducible (deterministic) stream of specified length
*/
function PseudoRandomStream (size, seed) {
  // deterministic pseudo-random integer generator
  function *IntegerGenerator () {
    const mt = Random.engines.mt19937()
    mt.seed(seed)
    while (true) {
      yield mt()
    }
  }

  // will wrap it with this helper function:
  function ByteGenerator (integerGenerator) {
    return function * () {
      for (let int of integerGenerator()) {
        // yield 4 bytes of the integer one after another
        yield int & 0xff
        yield (int >> 8) & 0xff
        yield (int >> 16) & 0xff
        yield (int >> 24) & 0xff
      }
    }
  }

  function LimitedGenerator (generator, size) {
    let count = 0
    return function * () {
      for (let value of generator()) {
        if (count++ >= size) return
        yield value
      }
    }
  }

  // All together now:
  const byteGen = ByteGenerator(IntegerGenerator)
  const byteGenLtd = LimitedGenerator(byteGen, size)
  const byteStream = StreamGenerator(byteGenLtd)

  return byteStream
}
