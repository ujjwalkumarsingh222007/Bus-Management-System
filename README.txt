SR University Bus Tracking and Management System
Setup and run (Windows / VS Code)
1. Install Node.js and MongoDB Community Server.
2. Start MongoDB.
3. Open the `backend` folder in VS Code, or open a terminal and run:
   powershell
   cd backend
   npm install
   npm start
4. Open this URL in your browser:

   http://localhost:5000

The database starts empty. Register Admin, Driver and Student accounts from the website. Then log in as Admin to add buses, create routes and allocate students.

Technologies
- Frontend: HTML, CSS, JavaScript
- Backend: Node.js, Express.js
- Database: MongoDB

Only Express and the official MongoDB Node.js driver are installed as external packages. Bus tracking is simulated.
