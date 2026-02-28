// creating a custom socket client and connecting it....
import net from 'node:net';
import "reflect-metadata/lite"; // Importing reflect-metadata for decorators support
import { Buffer } from 'node:buffer';
import * as SCTE104 from '@astronautlabs/scte104';
import { SpliceRequest, MultipleOperationMessage, Timestamp } from '@astronautlabs/scte104/dist/syntax.js';

let messageNumber = 1;
const message = new MultipleOperationMessage().with({
  operations: [
      new SpliceRequest().with({
          opID: SCTE104.MOP.SPLICE,
          spliceInsertType: SCTE104.SPLICE_START_NORMAL,
          spliceEventId: Math.floor(Date.now() / 1000),
          uniqueProgramId: 22211,
          preRollTime: 4000,
          breakDuration: 2400,
          availNum: 0,
          availsExpected: 0,
          autoReturnFlag: 1
      })
  ],
  timestamp: new Timestamp(),
})
.with({ messageNumber: messageNumber++ });

const data = message.serialize();
const payload = Buffer.from(data).toString('base64');
console.log(Buffer.from(data).toString('hex'));

console.log('Payload:', payload);

var client  = new net.Socket();
client.setEncoding('utf8');

client.connect({
  host: 'localhost',
  family: 4, // Use IPv4  
  port:5250
});


client.on('data',function(data){
    console.log('Data from server:' + data);
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
  client.write('APPLY 1-301 SCTE104 '+ payload + '\r\n', function() {
    console.log('Client: data sent to server');
  });

    setTimeout(function(){
        client.end('Bye bye server');
    },200);
});
