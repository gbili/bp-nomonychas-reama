export default class AuthHeaderToken {
  static getAsyncContextReqMethod(context) {
    return async function({ req }) {

      if (!req.headers || !req.headers.authorization) {
        return context;
      }

      const parts = req.headers.authorization.split(' ');

      if (parts.length !== 2 || !/^Bearer$/i.test(parts[0])) {
        throw new Error('credentials_bad_scheme', { message: 'Format is Authorization: Bearer [token]' });
      } else {
        context.token = parts[1];
      }

      return context;
    };
  }
}