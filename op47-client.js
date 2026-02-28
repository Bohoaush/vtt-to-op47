// creating a custom socket client and connecting it....
import net from 'node:net';
import { Buffer } from 'node:buffer';
import WSTEncoder from './wst-encoder.js';

const encoder = new WSTEncoder();
const res = encoder.encodeSubtitle(['Loď čeří kýlem tůň', 'obzvlášť v Grónské úžině.']);
const payload = res.map(data => Buffer.from(data).toString('base64')).join(' ');
console.log('Encoded payload:', payload);

var client  = new net.Socket();
client.setEncoding('utf8');

client.connect({
  host: 'localhost',
  family: 4, // Use IPv4  
  port:5250
});

client.on('connect',function(){
  console.log('Client: connection established with server');

  console.log('---------client details -----------------');
  var address = client.address();
  var port = address.port;
  var family = address.family;
  var ipaddr = address.address;
  console.log('Client is listening at port' + port);
  console.log('Client ip :' + ipaddr);
  console.log('Client is IP4/IP6 : ' + family);

  // writing data to server
  client.write('APPLY 1-301 OP47 '+ payload + ' \r\n', function() {
    console.log('Client: data sent to server');
  });
});


client.on('data',function(data){
  console.log('Data from server:' + data);
});

setTimeout(function(){
  client.end('Bye bye server');
},2000);
