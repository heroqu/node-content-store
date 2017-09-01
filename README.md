# content-store

Content server with file upload, automatic hashing and hash based naming scheme.

## Setup

```
npm install content-store
```

## Usage example

```javascript
const ContentStore = require('content-store')
const PORT = 8001
const storageDir = 'data'

// hash function implementation example
const { MetroHash128 } = require('metrohash')
function createHash () {
  const SEED = 0 // hard code the seed, can be any integer
  return new MetroHash128(SEED)
}

async function start () {
  const server = await ContentStore({ storageDir }, createHash)

  server.listen(PORT, (err) => {
    if (err) {
      return console.log('something bad happened', err)
    }

    console.log(`server is listening on ${server.url}`)
  })
}

start()
.catch(console.error)
```

 The `ContentStore` constructor function returns a server promise. The first parameter is `options` object with following defaults:

```javascript
{
  name: 'content-store',
  storageDir: 'data'
}
```

The second parameter is `createHash` function with desired implementation. This function should have no arguments and return a `hash` object, which should support two methods: `hash.update(chunk)` and `hash.digest(format)` with the same logics as in [node crypto module](https://nodejs.org/api/crypto.html#crypto_class_hash).

In the example above we used createHash function based on [metrohash module](https://www.npmjs.com/package/metrohash) implementation, which is one of well known non-cryptographic hashing algorithm out there.

Any other suitable hashing algorithm would do, be it cryptographic or non-cryptographic. Here is as example of `createHash` based on `sha256` algorithm from [node's crypto](https://nodejs.org/api/crypto.html#crypto_crypto_createhash_algorithm):

```javascript
const crypto = require('crypto')
function createHash () {
  return crypto.createHash('sha256')
}
```

which illustrates the ease of adopting other hashing algorithms.

## Idea

Imagine a server able to upload files and storing each uploaded file under the name based on hash digest of its content.

In this way the entity identification on the server side is entirely based on content's hash,
so we are safe to consider such a server a **content store**, as opposed to **file store**, because from external point of view it essentially operates on *contents* rather then on *files*.

One consequence of such an approach is that any two uploaded files with the same content are always stored under same name (and absolute path), so there is no way for file duplication on backend side.

Another consequence of the server being a *content store* is that it only supports 3 out of 4 CRUD operations:

```javascript
POST /upload
GET /:hash  
DELETE /:hash
```

There is no much sense in `updating a content`. Just like as it is in GIT where `updating a file` leads to two really unrelated operations (from GIT point of view): deleting old content entry and creating new content entry.
