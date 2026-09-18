const http = require('http');

http.get('http://localhost:3000/api/route?start_lat=19.1136&start_lng=72.8697&end_lat=19.0135&end_lng=72.8166&unit_id=UNIT-1', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log(JSON.stringify(JSON.parse(data), null, 2).substring(0, 500));
  });
});
