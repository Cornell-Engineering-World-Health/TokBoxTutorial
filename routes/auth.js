var express = require('express')
var router = express.Router()
var jwt = require('jwt-simple')
var moment = require('moment')
var request = require('request')

var User = require('../models/user')
var Errors = require('../resources/errors')

// Generate JSON Web Token
function createJWT (user) {
  var payload = {
    sub: user._id,
    iat: moment().unix(),
    exp: moment().add(14, 'days').unix()
  }
  return jwt.encode(payload, process.env.JWT_SECRET)
}

router.post('/google', function (req, res) {
  var accessTokenUrl = 'https://accounts.google.com/o/oauth2/token'
  var peopleApiUrl = 'https://www.googleapis.com/plus/v1/people/me/openIdConnect'
  var params = {
    code: req.body.code,
    client_id: req.body.clientId,
    client_secret: process.env.GOOGLE_AUTH_SECRET_KEY,
    redirect_uri: req.body.redirectUri,
    grant_type: 'authorization_code'
  }

  // Exchange authorization code for access token.
  request.post(accessTokenUrl, { json: true, form: params }, function (err, response, token) {
    if (err) {
      return res.status(500).json(Errors.INTERNAL_OAUTH(err))
    }
    var accessToken = token.access_token
    var headers = { Authorization: 'Bearer ' + accessToken }

    // Retrieve profile information about the current user.
    request.get({ url: peopleApiUrl, headers: headers, json: true }, function (err, response, profile) {
      if (err) {
        return res.status(500).json(Errors.INTERNAL_OAUTH(err))
      }
      if (profile.error) {
        return res.status(500).send({message: profile.error.message})
      }

      // Link user accounts.
      if (req.header('Authorization')) {
        User.findOne({ 'google.id': profile.sub }, function (err, existingUser) {
          if (err) {
            return res.status(500).json(Errors.INTERNAL_OAUTH(err))
          }
          if (existingUser) {
            return res.status(409).send({ message: 'There is already a Google account that belongs to you' })
          }
          var token = req.header('Authorization').split(' ')[1]
          var payload = jwt.decode(token, process.env.JWT_SECRET)
          User.findById(payload.sub, function (err, user) {
            if (err) {
              return res.status(500).json(Errors.INTERNAL_OAUTH(err))
            }
            if (!user) {
              return res.status(400).send({ message: 'User not found' })
            }
          })
        })
      } else {
        // Create a new user account or return an existing one.
        User.findOne({ 'email': profile.email }, function (err, existingUser) {
          if (err) {
            return res.status(500).json(Errors.INTERNAL_OAUTH(err))
          }
          if (existingUser) {
            existingUser.picture = existingUser.picture || profile.picture.replace('sz=50', 'sz=200')
            return res.send({ token: createJWT(existingUser) })
          }
          var user = new User()
          user.google.id = profile.sub
          user.firstName = profile.given_name
          user.lastName = profile.family_name
          user.email = profile.email
          user.calls = []
          user.contacts = []
          user.picture = profile.picture.replace('sz=50', 'sz=200')
          user.save(function (err) {
            if (err) {
              return res.status(500).json(Errors.INTERNAL_OAUTH(err))
            }
            var token = createJWT(user)
            res.send({ token: token })
          })
        })
      }
    })
  })
})

module.exports = router

// Google ID Tokens: https://developers.google.com/identity/protocols/OpenIDConnect
