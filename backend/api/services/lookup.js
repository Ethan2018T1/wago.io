/**
 * Standard lookup requests
 */

 var wowPatches = require('../helpers/wowPatches')

 /**
  * Wago lookup
  */
server.get('/lookup/wago', (req, res, next) => {
  if (!req.params.id) {
    return res.send(404, {error: "page_not_found"})
  }
  var timing = {}
  var start = Date.now()
  WagoItem.lookup(req.params.id).then((doc) => {
    timing.WagoLookup = Date.now() - start
    if (!doc) {
      return res.send(404, {error: "page_not_found"})
    }
    
    doc.popularity.views++
    doc.save()

    var wago = {}
    wago._id = doc._id
    if (doc.type === 'WEAKAURAS2') {
      wago.type = 'WEAKAURA'
    }
    else {
      wago.type = doc.type
    }
    wago.name = doc.name
    wago.slug = doc.slug
    wago.url = doc.url
    wago.visibility = { private: doc.private, hidden: doc.hidden, deleted: doc.deleted }
    wago.date = { created: doc.created, modified: doc.modified }
    wago.expires = doc.expires_at
    wago.patch = wowPatches.patchByDate(wago.date)
    wago.description = { text: doc.description, format: 'bbcode' }
    wago.categories = doc.categories
    
    wago.viewCount = doc.popularity.views
    wago.commentCount = doc.popularity.comment_count
    wago.downloadCount = doc.popularity.downloads
    wago.embedCount = doc.popularity.embeds
    wago.favoriteCount = doc.popularity.favorite_count
    if (req.user) {
      doc.popularity.favorites.forEach((userID) => {
        if (req.user._id.equals(userID)) {
          wago.myfave = true
        }
      })
    }

    timing.startingParallel = Date.now() - start
    wago.UID = doc._userId
    async.parallel({
      userLookup: (cb) => {
        if (!wago.UID) {
          return cb(null, {            
            name: null,
            searchable: false,
            roleClass: 'user-anon',
            avatar: '/media/avatars/anon.png'
          })
        }

        User.findById(wago.UID).then((user) => {
          timing.findUser = Date.now() - start
          var u = {}
          u.name = user.account.username
          u.searchable = !user.account.hidden
          u.roleClass = user.roleclass
          u.avatar = user.avatarURL
          if (user.account.verified_human) {
            wago.description.enableLinks = true
          }
          cb(null, u)
        })
      },
      screenshotLookup: (cb) => {
        Screenshot.findForWago(wago._id).then((screens) => {
          timing.findScreenshots = Date.now() - start
          if (!screens) {
            return cb(null)
          }
          var ss = []
          screens.forEach((screen) => {
            ss.push({_id: screen._id.toString(), src: screen.url, title: screen.caption })
          })
          cb(null, ss)
        })
      },
      videoLookup: (cb) => {
        Video.findForWago(wago._id).then((videos) => {
          timing.findVideos = Date.now() - start
          if (!videos) {
            return cb(null)
          }
          var vids = []
          videos.forEach((video) => {
            vids.push({_id: video._id.toString(), url: video.url, thumb: video.thumbnail, embed: video.embed })
          })
          cb(null, vids)
        })
      },
      collectionLookup: (cb) => {
        WagoItem.find({"type": "COLLECTION", "collect": wago._id.toString(), "deleted": false, "private": false, "hidden": false})
          .sort('-modified').limit(10).populate('_userId').then((coll) => {
            timing.findCollections = Date.now() - start
            if (!coll) {
              return cb(null)
            }
            var collections = []
            coll.forEach((c) => {
              collections.push({name: c.name, slug: c.slug, modified: c.modified, user: {name: c._userId.profile.name, class: c._userId.roleclass, avatar: c._userId.avatarURL, profile: c._userId.profile.url}})
            })
            cb(null, collections)
        })
      },
      collectionCount: (cb) => {
        WagoItem.count({"type": "COLLECTION", "collect": wago._id.toString(), "deleted": false, "private": false, "hidden": false})
          .then((count) => {
            timing.countCollections = Date.now() - start
            return cb(null, count)
        })
      },
      codeLookup: (cb) => {
        WagoCode.lookup(wago._id, req.params.version).then((code) => {
          timing.findCode = Date.now() - start
          if (!code) {
            return cb()
          }
          cb(null, {json: code.json, encoded: code.encoded})
        })
      },
      versionsLookup: (cb) => {
        WagoCode.find({auraID: wago._id}).select('json version updated').limit(10).sort({updated: -1}).then((versions) => {
          timing.findVersions = Date.now() - start
          if (!versions) {
            return cb()
          }
          WagoCode.count({auraID: wago._id}).then((count) => {
            timing.countVersions = Date.now() - start
            var v = []
            for (var i=0; i<versions.length; i++) {
              v.push({version: count - i, size: versions[i].json.length, date: versions[i].updated})
            }
            cb(null, {total: count, versions: v})
          })
        })
      },
      commentLookup: (cb) => {
        Comments.find({wagoID: wago._id}).sort({postDate: -1}).limit(10).populate('authorID').then((comments) => {
          timing.findComments = Date.now() - start
          if (!comments) {
            return cb()
          }
          var c = []
          for (var i=0; i<comments.length; i++) {
            c.push({
              cid: comments[i]._id.toString(),
              date: comments[i].postDate, 
              text: comments[i].commentText, 
              format: 'bbcode',
              author: { 
                name: comments[i].authorID.account.username || 'User-' + comments[i].authorID._id.toString(),
                avatar: comments[i].authorID.avatarURL,
                class: comments[i].authorID.roleclass,
                profile: comments[i].authorID.profile.url,
                enableLinks: comments[i].authorID.account.verified_human
              }
            })
          }
          cb(null, c)
        })
      },
      commentCount: (cb) => {
        Comments.count({wagoID: wago._id}).then((count) => {
          timing.countComments = Date.now() - start
          cb(null, count)
        })
      },
      forkLookup: (cb) => {
        if (!doc.fork_of) {
          return cb()
        }
        WagoItem.findById(doc.fork_of).then((doc) => {
          if (!doc || doc.hidden || doc.private) {
            return cb()
          }
          var fork = {}
          fork._id = doc._id
          fork.name = doc.name
          cb(null, fork)
        })
      }
    }, function (err, data) {
      timing.doneParallel = Date.now() - start
      // parallel finished
      wago.alerts = {}
      wago.code = data.codeLookup
      wago.versions = data.versionsLookup
      wago.collectionCount = data.collectionCount
      wago.collections = data.collectionLookup
      wago.user = data.userLookup
      wago.screens = data.screenshotLookup
      wago.videos = data.videoLookup
      wago.commentCount = data.commentCount
      wago.comments = data.commentLookup
      wago.fork = data.forkLookup

      // check for alerts
      // functions blocked by WeakAuras
      while ((m = commonRegex.WeakAuraBlacklist.exec(wago.code.json)) !== null) {
        if (!wago.alerts.blacklist) {
          wago.alerts.blacklist = []
        }
        wago.alerts.blacklist.push(m[1].replace(/\\"/g, '"'))
      }
      
      // check for functions that could be used for malintent
      while ((m = commonRegex.MaliciousCode.exec(wago.code.json)) !== null) {
        if (!wago.alerts.malicious) {
          wago.alerts.malicious = []
        }
        wago.alerts.malicious.push(m[1])
      }

      if (req.params.timing) {
        timing.done = Date.now() - start
        return res.send(timing)
      }
      res.send(wago)
    })
  })
})

server.get('/lookup/wago/versions', (req, res, next) => {
  if (!req.params.id) {
    return res.send(404, {error: "page_not_found"})
  }
  WagoItem.lookup(req.params.id).then((doc) => {
    if (!doc) {
      return res.send(404, {error: "page_not_found"})
    }

    WagoCode.find({auraID: req.params.id}).select('json version updated').skip(10).sort({updated: -1}).then((versions) => {
      if (!versions) {
        return cb()
      }
      WagoCode.count({auraID: req.params.id}).then((count) => {
        var v = []
        for (var i=0; i<versions.length; i++) {
          v.push({version: count - i - 10, size: versions[i].json.length, date: versions[i].updated})
        }
        return res.send(v)
      })
    })
  })
})

server.get('/lookup/wago/collections', (req, res, next) => {
  if (!req.params.id) {
    return res.send(404, {error: "page_not_found"})
  }
   WagoItem.find({"type": "COLLECTION", "collect": req.params.id, "deleted": false, "private": false, "hidden": false})
    .sort('-modified').skip(10).populate('_userId').then((coll) => {
      if (!coll) {
        return res.send([])
      }
      var collections = []
      coll.forEach((c) => {
        collections.push({name: c.name, slug: c.slug, modified: c.modified, user: {name: c._userId.profile.name, class: c._userId.roleclass, avatar: c._userId.avatarURL, profile: c._userId.profile.url}})
      })
      return res.send(collections)
  })
})

server.get('/lookup/wago/comments', (req, res, next) => {
  if (!req.params.id || !req.params.page) {
    return res.send(404, {error: "page_not_found"})
  }
  Comments.find({wagoID: req.params.id}).sort({postDate: -1}).limit(10).skip(10 * parseInt(req.params.page)).populate('authorID').then((comments) => {
    if (!comments) {
      return res.send([])
    }
    var c = []
    for (var i=0; i<comments.length; i++) {
      c.push({
        cid: comments[i]._id.toString(),
        date: comments[i].postDate, 
        text: comments[i].commentText, 
        format: 'bbcode',
        author: { 
          name: comments[i].authorID.account.username || 'User-' + comments[i].authorID._id.toString(),
          avatar: comments[i].authorID.avatarURL,
          class: comments[i].authorID.roleclass,
          profile: comments[i].authorID.profile.url,
          enableLinks: comments[i].authorID.account.verified_human
        }
      })
    }
    return res.send(c)
  })
})

server.get('/lookup/profile', (req, res, next) => {
  if (!req.params.user) {
    return res.send(404, {error: "page_not_found"})
  }

  User.findByUsername (req.params.user).then((user) => {
    var profile = {}
    profile.public = !(user.account.hidden)
    profile.name = user.account.username
    profile.roleClass = user.roleClass
    profile.description = user.profile.description
    profile.avatar = user.avatarURL
    if (req.user && req.user._id.equals(user._id)) {
      profile.mine = true
    }
    res.send(profile)
  })
})