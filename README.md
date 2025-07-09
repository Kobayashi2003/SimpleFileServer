# SimpleFileServer

A simple file server that allows users to browse, upload, download, and manage files.

## Example

![Example](./example/exam1.png)

![Example](./example/exam2.png)

![Example](./example/exam3.png)

![Example](./example/exam4.png)

## Installation and Running

### Prerequisites
- Node.js 18+ and npm

### Installation Steps

1. Clone the repository
```bash
git clone https://github.com/Kobayashi2003/SimpleFileServer.git
cd SimpleFileServer
```

2. Install dependencies
```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

3. Configuration
Set the base directory in `backend/config.js`:
```js
module.exports = {
  baseDirectory: process.env.BASE_DIRECTORY || 'your/path/here',
}
```

4. Run the servers
```bash
# Run the backend server (development mode) (Default port: 11073)
cd backend
npm run dev

# Or run the backend server (production mode) (Default port: 11073)
cd backend
npm start

# In another terminal, run the frontend server (Default port: 2711)
cd frontend
npm run dev

# Or run the frontend server (production mode) (Default port: 2711)
cd frontend
npm run build
npm start
```

5. Access the application
Open your browser and navigate to `http://localhost:${YOUR_PORT_HERE}`

## Features

## License

[MIT](LICENSE)

## Author

[Kobayashi2003](https://github.com/Kobayashi2003)
