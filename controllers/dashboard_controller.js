const db = require('../db').callbackPool;
const { 
  getStatsQuery, 
  getRecentVisitorsQuery, 
  getUpcomingAppointmentsQuery 
} = require('../queries/dashboard_queries');

const getDashboardData = (req, res) => {
  const responseData = {
    stats: {},
    recentVisitors: [],
    upcomingAppointments: []
  };

  // Callback hell avoidance could be done with promises, but sticking to callback pattern for consistency
  // 1. Get Stats
  db.query(getStatsQuery, (err, statsResult) => {
    if (err) {
      console.error('Dashboard Stats Error:', err);
      return res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
    responseData.stats = statsResult[0];

    // 2. Get Recent Visitors
    db.query(getRecentVisitorsQuery, (err, visitorsResult) => {
      if (err) {
        console.error('Dashboard Visitors Error:', err);
        return res.status(500).json({ error: 'Failed to fetch recent visitors' });
      }
      responseData.recentVisitors = visitorsResult;

      // 3. Get Upcoming Appointments
      db.query(getUpcomingAppointmentsQuery, (err, appointmentsResult) => {
        if (err) {
          console.error('Dashboard Appointments Error:', err);
          return res.status(500).json({ error: 'Failed to fetch appointments' });
        }
        responseData.upcomingAppointments = appointmentsResult;

        // Send Final Response
        res.status(200).json(responseData);
      });
    });
  });
};

module.exports = {
  getDashboardData
};
