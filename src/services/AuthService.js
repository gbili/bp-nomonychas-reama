export default class AuthService {

  constructor({ models, hasher, tokenConfig, events }) {
    this.models = models;
    this.hasher = hasher;
    this.tokenConfig = tokenConfig;
    this.events = events;
  }

  async register({ username, email, plainPassword }) {
    const { PasswordUserModel } = this.models;

    const cryptedPassword = await this.hasher.hash(plainPassword);
    let passwordUser = null;
    try {
      passwordUser = await PasswordUserModel.create({ username, email, cryptedPassword });
    } catch (err) {
      this.events.emit('AuthService:register:error', err);
    }

    if (!passwordUser) {
      this.events.emit('AuthService:register:fail', { username, email, message: "Try logging in if you are a member" });
      return null;
    }

    const user = passwordUser.userInstance;
    this.events.emit('AuthService:register:success', user);

    return user;
  }

  async authenticate({ token, loginInput }) {
    const { TokenUser } = this.models;

    let tokenUser = null;
    if (token) {
      tokenUser = this.authenticateTokenStrategy({ token });
    } else if (loginInput) {
      tokenUser = await this.authenticateLoginStrategy({ loginInput });
    } else {
      throw new Error('AuthService:authenticate() requires a token or loginInput');
    }

    if (!tokenUser) {
      this.events.emit('AuthService:authenticate:fail');

      return null;
    }

    this.events.emit('AuthService:authenticate:success', tokenUser);

    return tokenUser;
  }

  authenticateTokenStrategy({ token }) {
    const { TokenUser } = this.models;

    const jsonPayload = this.verifyToken({ token });
    if (!jsonPayload) {
      this.events.emit('AuthService:authenticateTokenStrategy:fail', token);
      throw new Error('AuthService:authenticateTokenStrategy() authentication fail', token);
    }

    const payload = JSON.parse(jsonPayload);

    if (!payload.exp || !payload.aud) {
      this.events.emit('AuthService:authenticateTokenStrategy:fail token was malformed by server', token);
      throw new Error('AuthService:authenticateTokenStrategy() authentication fail', token);
    }

    const { exp: expirationTime, aud: ID, } = payload;

    if (expirationTime <= this.tokenConfig.now()) {
      this.events.emit('AuthService:authenticateTokenStrategy:fail expired token', token);
      throw new Error('AuthService:authenticateTokenStrategy() authentication fail, please login again', token);
    }

    const tokenUser = new TokenUser({ userInfo: { ID }, token });
    this.events.emit('AuthService:authenticateTokenStrategy:success', tokenUser);

    return tokenUser;
  }

  async authenticateLoginStrategy({ loginInput }) {
    const { TokenUser } = this.models;

    const user = await this.verifyPassword(loginInput);
    if (!user) {
      this.events.emit('AuthService:authenticateLoginStrategy:fail');

      return null;
    }

    const tokenUser = new TokenUser({ userInfo: user, token: this._generateToken({ user }) });
    this.events.emit('AuthService:authenticateLoginStrategy:success', tokenUser);

    return tokenUser;
  }

  async verifyPassword({ username, email, plainPassword }) {
    const { PasswordUserModel } = this.models;

    let passwordUser = null;
    try {
      passwordUser = await PasswordUserModel.findOne({ username, email });
    } catch (err) {
      this.events.emit('AuthService:verifyPassword:error:storage', err);
    }

    if (!passwordUser) {
      this.events.emit('AuthService:verifyPassword:fail:userNotFound', { username, email });

      return null;
    }

    let passwordsMatch = false;
    try {
      passwordsMatch = await this.hasher.verify(passwordUser.cryptedPassword, plainPassword);
    } catch (err) {
      this.events.emit('AuthService:verifyPassword:error:hasher', err);
    }

    if (!passwordsMatch) {
      this.events.emit('AuthService:verifyPassword:fail:wrongPassword', { username, email });

      return null;
    }

    const user = passwordUser.userInstance;
    this.events.emit('AuthService:verifyPassword:success', user);

    return user;
  }


  /**
   * IMPORTANT: If you are going to verify from a different server than the one who signs,
   * and that server is to be managed by someone else than the signing server,
   * then it makes sense to switch to RSA in order to withhold the signing
   * power within the signing server owners.
   */
  _generateToken({ user }) {
    const { engine, expiresIn, algorithm, keys } = this.tokenConfig;
    const secret = keys.privateKey;

    const options = {
      header: {
        alg: algorithm
      },
      payload: {
        aud: user.ID,
        exp: expiresIn(),
      },
      secret
    };
    const token = engine.sign(options);
    this.events.emit('AuthService:_generateToken:success', token);

    return token;
  }

  verifyToken({ token }) {
    const { engine, expiresIn, algorithm, keys } = this.tokenConfig;
    let secret = null;
    if (!keys.privateKey) {
      throw new Error('AuthService:verifyToken() bad configuration, need at least a keys.privateKey', algorithm);
    }
    if (algorithm.charAt(0) === 'H') {
      secret = keys.privateKey;
    } else if (algorithm.charAt(0) === 'R') {
      if (!keys.publicKey) {
        throw new Error('AuthService:verifyToken() bad configuration, need a keys.publicKey with RSA algorithm', algorithm);
      }
      secret = keys.publicKey;
    } else {
      throw new Error('AuthService:verifyToken() unsupported encryption algorithm', algorithm);
    }

    const tokenMatchesSecret = engine.verify(token, algorithm, secret);
    if (!tokenMatchesSecret) {
      this.events.emit('AuthService:verifyToken:fail', token);
      return false;
    }

    const { payload } = engine.decode(token);
    this.events.emit('AuthService:verifyToken:success', payload);

    return payload;
  }

}
