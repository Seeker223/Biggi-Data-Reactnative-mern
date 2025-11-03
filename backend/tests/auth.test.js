const request = require('supertest');

const app = require('../app'); // Your Express app instance

describe('Auth API', () => {

  it('should register a new user', async () => {

    const res = await request(app)

      .post('/api/auth/register')

      .send({

        username: 'testuser',

        email: 'test@example.com',

        password: 'password123',

      });

    expect(res.statusCode).toEqual(201);

    expect(res.body).toHaveProperty('_id');

  });


  it('should login an existing user', async () => {

    const res = await request(app)

      .post('/api/auth/login')

      .send({

        email: 'test@example.com',

        password: 'password123',

      });

    expect(res.statusCode).toEqual(200);

    expect(res.headers['set-cookie']).toBeDefined();

  });

});