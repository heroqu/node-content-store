const ContentStore = require('../')

const { assert } = require('chai')
const request = require('request-promise-native')
const ERRS = require('restify-errors')

const fs = require('fs-extra')
const path = require('path')
const createHash = require('./metrohash')

const eventPromise = require('../lib/event-promise')

const PseudoRandomStream = require('./prnd-stream')

const sampleDir = path.resolve(__dirname, 'test_samples')
const storeDir = path.resolve(__dirname, 'test_store')
const downloadDir = path.resolve(__dirname, 'test_download')

async function fileReadStream (size, name) {
  await fs.ensureDir(sampleDir)

  const samplePath = path.resolve(sampleDir, `${name}.txt`)
  const seed = 123
  const rs = PseudoRandomStream(size, seed)
  const ws = fs.createWriteStream(samplePath)
  rs.pipe(ws)

  await eventPromise(ws, 'finish')

  return fs.createReadStream(samplePath)
}

describe('content-store', function () {
  let server
  let sampleReadStreams

  before(async function () {
    server = await ContentStore({
      storageDir: storeDir
    }, createHash)

    server.listen(8001)
  })

  after(function () {
    server.close()
  })

  describe('Checks', function () {
    it('should return 200 on root path', function () {
      let opts = {
        uri: `${server.url}`,
        resolveWithFullResponse: true,
        json: true
      }

      return request.get(opts)
      .then((res) => {
        assert.equal(res.statusCode, 200)
      })
    })

    it('should respond to a health check request', function () {
      let opts = {
        uri: `${server.url}/health`,
        resolveWithFullResponse: true,
        json: true
      }

      return request.get(opts)
      .then((res) => {
        assert.equal(res.statusCode, 200, 'The response status code is wrong.')
        assert.isOk(res.body, 'The response body is empty.')
        assert.equal(res.body.result, 'OK, healthy.', 'The result value is wrong.')
      })
    })
  })

  describe('Uploading', function () {
    beforeEach(async function () {
      sampleReadStreams = [
        await fileReadStream(100, 'sample01'),
        await fileReadStream(1000, 'sample02'),
        await fileReadStream(10000, 'sample03')
      ]
    })

    before(async function () {
      await fs.remove(sampleDir)
      await fs.remove(storeDir)
    })

    after(async function () {
      await fs.remove(sampleDir)
      await fs.remove(storeDir)
    })

    it('Should upload single file', function () {
      const expected = '374fe2b6c3814ec1179354ff1434f357'

      let opts = {
        url: `${server.url}/upload`,
        resolveWithFullResponse: true,
        json: true,
        formData: {
          sample_file: sampleReadStreams[2]
        }
      }

      return request.post(opts)
      .then(res => {
        assert.equal(res.statusCode, 201, 'The response status code')

        const files = res.body.files
        assert.isArray(files, 'list of uploaded files is not Array')
        assert.equal(files.length, 1, 'list of uploaded files has wrong length')
        assert.equal(files[0][1], expected, 'wrong hash of uploaded file')
      })
    })

    it('Should upload three files at once', function () {
      const expected_1 = 'd5f8c115a2c8cdddd6b2ecfc6bf708cf'
      const expected_2 = '1e6844d54db6b214552262d046e7fc95'
      const expected_3 = '374fe2b6c3814ec1179354ff1434f357'

      let opts = {
        url: `${server.url}/upload`,
        resolveWithFullResponse: true,
        json: true,
        formData: {
          file_1: sampleReadStreams[0],
          file_2: sampleReadStreams[1],
          file_3: sampleReadStreams[2]
        }
      }

      return request.post(opts)
      .then(res => {
        let files = res.body.files
        assert.isArray(files, 'list of uploaded files is not Array')
        assert.equal(files.length, 3, 'list of uploaded files has wrong length')
        assert.equal(files[0][1], expected_1, 'wrong hash of 1st uploaded file')
        assert.equal(files[1][1], expected_2, 'wrong hash of 2nd uploaded file')
        assert.equal(files[2][1], expected_3, 'wrong hash of 3rd uploaded file')
      })
    })
  })

  describe('Deleting', function () {
    let rs

    before(async function () {
      await fs.remove(sampleDir)
      await fs.remove(storeDir)
      rs = await fileReadStream(100, 'sample01')
    })

    after(async function () {
      await fs.remove(sampleDir)
      await fs.remove(storeDir)
    })

    it('Should delete the resource', async function () {

      // 1. upload a sample
      let opts = {
        url: `${server.url}/upload`,
        resolveWithFullResponse: true,
        json: true,
        formData: {
          sample_file: rs
        }
      }

      let res = await request.post(opts)

      assert.equal(res.statusCode, 201, 'The response status code')

      // 2. get ID of just uploaded file
      let fileId = (res.body.files)[0][1]

      // 3. delete the resource
      opts = {
        url: `${server.url}/${fileId}`,
        resolveWithFullResponse: true,
        json: true
      }

      res = await request.del(opts)
      assert.equal(res.statusCode, 200, 'The response status code')
    })
  })

  describe('Downloading', function () {
    let rs

    before(async function () {
      await fs.remove(sampleDir)
      await fs.remove(storeDir)
      await fs.remove(downloadDir)
      await fs.ensureDir(downloadDir)
      rs = await fileReadStream(100, 'sample01')
    })

    after(async function () {
      await fs.remove(sampleDir)
      await fs.remove(storeDir)
      await fs.remove(downloadDir)
    })

    it('Should download the resource', async function () {
      let opts = {
        url: `${server.url}/upload`,
        resolveWithFullResponse: true,
        json: true,
        formData: {
          sample_file: rs
        }
      }

      let res = await request.post(opts)

      assert.equal(res.statusCode, 201, 'The response status code')

      const filename = (res.body.files)[0][1]

      let downloadPath = path.resolve(downloadDir, 'sample.dat')
      const ws = fs.createWriteStream(downloadPath)

      request(`${server.url}/${filename}`).pipe(ws)

      await eventPromise(ws, 'finish')

      let stats = fs.statSync(downloadPath)
      assert.equal(stats.size, 100, 'downloaded file size is wrong')
    })
  })
})
