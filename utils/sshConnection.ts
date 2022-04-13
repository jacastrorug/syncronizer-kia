import * as SSH2 from "ssh2";
import * as MySQL from "mysql2";
import { ForwardConfig } from "../models/ForwardConfig";

export const SSHConnection = (configSSHConnection: SSH2.ConnectConfig, dbConfig: MySQL.ConnectionOptions, forwardConfig: ForwardConfig) => {
    const sshClient = new SSH2.Client();

    return new Promise((resolve, reject) => {

        sshClient.on('ready', () => {
            console.log('ssh connected ✅');
        
            sshClient.forwardOut(forwardConfig.srcHost, 
                forwardConfig.srcPort, 
                forwardConfig.dstHost, 
                forwardConfig.dstPort,
                async (err, stream) => {
                    if(err) {
                        reject(err);
                    }
    
                    const updatedDBServer: MySQL.ConnectionOptions = {
                        ...dbConfig,
                        stream: stream
                    };
        
                    const connection = MySQL.createConnection(updatedDBServer);
                    connection.connect((err) => {
                        if(err) {
                            reject(err)
                        }
    
                        resolve(connection);
                    });
        
                });
        
        
        }).connect(configSSHConnection);

    });
};