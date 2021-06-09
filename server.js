const path = require('path');
const stream = require('stream');
const http = require('http');
const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-body');
const formidable = require('formidable');
const cors = require('@koa/cors');
const winston = require('winston');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const FormData = require('form-data');

require('dotenv').config();

const {
  NODE_ENV = 'development',
  PORT = '3000',
  KEY = 'dev',
  CORS_ORIGIN,
  PINATA_API_KEY,
  PINATA_API_SECRET,
} = process.env;

(async () => {
  const logger = winston.createLogger({
    level: NODE_ENV === 'development' ? 'silly' : 'info',
    transports: [new winston.transports.Console()],
    format: winston.format.combine(
      winston.format.label(),
      winston.format.timestamp(),
      winston.format.json(),
    ),
  });

  try {
    const app = new Koa();

    app.keys = [KEY];

    app.use(async (ctx, next) => {
      try {
        logger.http(ctx.req);
        await next();
        logger.http(ctx.res);
      } catch (err) {
        console.error(err);
        ctx.throw(err);
      }
    });

    app.use(
      cors({
        origin: CORS_ORIGIN,
      }),
    );

    const router = new Router();

    router.post(
      '/api/ipfs/pin',
      async (ctx, next) => {
        const pinataForm = new FormData({
          pauseStreams: false,
          maxDataSize: 10 * 1024 * 1024,
        });
        pinataForm.append(
          'pinataOptions',
          JSON.stringify({
            cidVersion: 1,
          }),
        );
        const form = formidable({
          multiples: true,
          keepExtensions: true,
          uploadDir: path.resolve('/', uuidv4()),
          filter: (part) => ['files'].includes(part.name),
          filename: (name, ext) =>
            path.format({
              ...(path.dirname(name) && {
                dir: path.dirname(name).split(path.sep).slice(1).join(path.sep),
              }),
              name: path.basename(name),
              ext,
            }),
          fileWriteStreamHandler: (file) => {
            const passStream = new stream.PassThrough();
            pinataForm.append('file', passStream, {
              filepath: file.filepath,
            });
            return passStream;
          },
        });
        console.log(pinataForm);
        await new Promise((resolve, reject) => {
          form.parse(ctx.req, (err, fields, files) => {
            if (err) {
              reject(err);
              return;
            }
            ctx.form = { fields, files };
            ctx.pinataForm = pinataForm;
            resolve();
          });
        });
        await next();
      },
      async (ctx) => {
        console.log(ctx.form);
        const res = await axios.post(
          `${new URL('/pinning/pinFileToIPFS', 'https://api.pinata.cloud')}`,
          ctx.pinataForm,
          {
            headers: {
              ...ctx.pinataForm.getHeaders(),
              pinata_api_key: PINATA_API_KEY,
              pinata_secret_api_key: PINATA_API_SECRET,
            },
          },
        );
        ctx.body = { cid: res.data.IpfsHash };
      },
    );

    router.post('/api/ipfs/unpin', bodyParser(), async (ctx) => {
      const { cid } = ctx.request.body;
      await axios.delete(
        `${new URL(`/pinning/unpin/${cid}`, 'https://api.pinata.cloud')}`,
        {
          headers: {
            pinata_api_key: PINATA_API_KEY,
            pinata_secret_api_key: PINATA_API_SECRET,
          },
        },
      );
      ctx.body = {};
    });

    app.use(router.routes());
    app.use(router.allowedMethods());

    app.on('error', (err) => {
      logger.error(err);
    });

    const server = http.createServer(app.callback());
    server.listen(Number(PORT), () => {
      logger.info(`Listening on port: ${PORT}...`);
    });
  } catch (err) {
    logger.error(err);
  }
})();
