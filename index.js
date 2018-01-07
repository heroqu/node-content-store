'use strict'
const restify = require('restify')
const ERRS = require('restify-errors')
const logger = require('morgan')
const multiparty = require('multiparty')
const path = require('path')
const os = require('os')
const fs = require('fs-extra')
const { randomBytes } = require('crypto')
const eventPromise = require('./lib/event-promise')
const HashThrough = require('hash-through')

async function ContentStore (opts, createHash) {
  if (!createHash || typeof createHash !== 'function') {
    throw new TypeError('createHash should be a function')
  }

  opts = { // apply defaults
    name: 'content-store',
    storageDir: 'data',
    ...opts
  }

  const storageDir = path.resolve(process.cwd(), opts.storageDir)

  function tmpFileName () {
    return path.resolve(os.tmpdir(), `tmp_${randomBytes(16).toString('hex')}`)
  }

  function destFileName (basename) {
    return path.resolve(storageDir, `${basename}`)
  }

  await fs.ensureDir(storageDir)

  const server = restify.createServer({ name: opts.name })

  server.use(logger('dev'))
  server.use(restify.plugins.acceptParser(server.acceptable))

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

    // call this one before any subtask is started
    function taskPlus () {
      taskCounter++
    }

    // call this one after any subtask is finished
    function taskMinus() {
      taskCounter--
      if (taskCounter === 0) {
        // Time to respond
        if (files.length === 0) {
          res.send(200, {
            result: 'no files to upload',
            files
          })
        } else {
          res.send(201, {
            result: 'upload OK',
            files
          })
        }
        next()
      }
    }

    // {autoFields: true} to allow omitting form.on('field',...)
    // without hanging on request
    const form = new multiparty.Form({ autoFields: true })

    function onAnyError (err) {
      res.send(new ERRS.InternalServerError(err))
      next()
    }

    form.on('part', async function (part) {
      part.on('error', onAnyError)

      try {
        if (part.filename) {
          // part is a readable stream of data for a single file.
          // If multiple files are being uploaded, then 'part' event
          // will be triggered that much times.

          taskPlus()  // add a task for current file

          const tmpFile = tmpFileName()
          const fileSink = fs.createWriteStream(tmpFile)

          // a stream to calculate the data hash on the fly
          const ht = HashThrough(createHash)

          // Pipe file's data to disk
          part.pipe(ht).pipe(fileSink)
          await (eventPromise(fileSink, 'finish'))

          // By now both the file is written down and the hash is ready.
          // Let's take the digest and use it as a destination file name.
          const destBaseName = ht.digest('hex')
          files.push([part.filename, destBaseName])

          // rename tmp file
          const destFile = destFileName(destBaseName)
          await fs.move(tmpFile, destFile, {overwrite: true})

          taskMinus()    // done with this file
        }
      } catch (err) {
        onAnyError(err)
      }
    })

    form.on('close', taskMinus)  // done with parsing form

    form.on('error', onAnyError)

    // Let's start

    taskPlus()        // add a task for parsing form
    form.parse(req)
  })

  server.on('uncaughtException', function (req, res, route, err) {
    res.send(500, 'Unexpected error occured')
  })

  return server
}

module.exports = ContentStore
