'use strict'
// restify stuff
const restify = require('restify')
const ERRS = require('restify-errors')
const logger = require('morgan')
const multiparty = require('multiparty')

// working with files
const path = require('path')
const os = require('os')
const fs = require('fs-extra')

const { randomBytes } = require('crypto')
const eventPromise = require('./lib/event-promise')

// hashing pass-through stream constructor
const HashThrough = require('hash-through')

async function ContentStore (opts, createHash) {
  if (!createHash || typeof createHash !== 'function') {
    throw new TypeError('createHash should be a function')
  }

  // override these defaults with opts
  let defaults = {
    name: 'content-store',
    storageDir: 'data'
  }

  opts = Object.assign({}, defaults, opts)

  const storageDir = path.resolve(process.cwd(), opts.storageDir)

  // helper functions

  // full path to a temporary file
  function tmpFileName () {
    return path.resolve(os.tmpdir(), `tmp_${randomBytes(16).toString('hex')}`)
  }

  // full path to a destination file
  function destFileName (basename) {
    return path.resolve(storageDir, `${basename}`)
  }

  // 1. Create storage directory if absent

  await fs.ensureDir(storageDir)

  // 2. Create server

  const server = restify.createServer({ name: opts.name })

  server.use(logger('dev'))
  server.use(restify.plugins.acceptParser(server.acceptable))

  // 3. Set up routes

  server.get('/', function (req, res, next) {
    res.send(200, {result: `Hi, this is a ${server.name}. Use POST /upload to feed me with files.`})
    next()
  })

  server.get('/health', function (req, res, next) {
    res.send(200, {result: 'OK, healthy.'})
    next()
  })

  server.get('\/.*', restify.plugins.serveStatic({
    directory: storageDir
  }))

  server.del('/:id', (req, res, next) => {
    const filepath = path.resolve(storageDir, req.params.id)

    fs.pathExists(filepath)
    .then(exists => {
      if (exists) {
        fs.remove(filepath)
        .then(_ => {
          res.send(200)
          next()
        })
        .catch(err => {
          res.send(new ERRS.ConflictError(err))
          next()
        })
      } else {
        res.send(new ERRS.NotFoundError())
        next()
      }
    })
    .catch(err => {
      res.send(new ERRS.InternalServerError(err))
      next()
    })
  })

  server.post('/upload', function (req, res, next) {
    let files = []

    // Will count the things we have to finish before sending a response.
    // The counter will be 0 when and only when:
    //  1. the form is fully parsed (form 'close' event is detected)
    //  2. all the files ('file parts' in terms of multiparty) have been
    //      successfully written to disk
    let taskCounter = 0

    function taskPlus () {
      taskCounter++
    }

    // call this one after any subtask is finished
    function taskMinus () {
      taskCounter--
      if (taskCounter === 0) {
        // Time to respond
        if (files.length === 0) {
          res.send(200,
            {
              result: 'no files to upload',
              files
            }
          )
        } else {
          res.send(201,
            {
              result: 'upload OK',
              files
            }
          )
        }

        next()
      }
    }

    // {autoFields: true} option allows omitting form.on('field',...)
    // handler altogether. Otherwise, without such a handler,
    // the server would got stuck waiting for the 'field' event
    // to be handled. But as we are only interested in files
    // here then we are good to go like this.
    const form = new multiparty.Form({ autoFields: true })

    function onAnyError (err) {
      res.send(new ERRS.InternalServerError(err))
      next()
    }

    form.on('part', async function (part) {
      part.on('error', onAnyError)

      try {
        if (part.filename) {
          // This part is a file readable stream.
          // If more then one file is being uploading, then 'part' event
          // will be triggered that much times.

          // register a task for each part (=for each uploading file)
          taskPlus()

          const tmpFile = tmpFileName()
          const fileSink = fs.createWriteStream(tmpFile)

          // create hashing stream
          const ht = HashThrough(createHash)

          // Pipe file's data to a tmp file
          part.pipe(ht).pipe(fileSink)

          await (eventPromise(fileSink, 'finish'))
          .catch(onAnyError)

          // By now both the file is written down and the hash is ready.
          // Let's use the digest for the destination file name.
          const destBaseName = ht.digest('hex')
          files.push([part.filename, destBaseName])

          const destFile = destFileName(destBaseName)

          // rename the tmp file
          await fs.move(tmpFile, destFile, {overwrite: true})
          .catch(onAnyError)

          // done with this file
          taskMinus()
        }
      } catch (err) {
        onAnyError(err)
      }
    })

    form.on('close', function () {
      // all parts are parsed and emitted, but that doesn't mean those
      // parts are already written down to the disk.
      // Not ready to respond yet, just deregister the parsing task:
      taskMinus()
    })

    form.on('error', onAnyError)

    // start parsing...
    form.parse(req)

    // ... and register this as a separate task.
    taskPlus()
  })

  server.on('uncaughtException', function (req, res, route, err) {
    res.send(500, 'Unexpected error occured')
  })

  return server
}

module.exports = ContentStore
