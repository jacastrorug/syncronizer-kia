import "dotenv/config";
import { connect, query, config } from "mssql";
import * as MySQL from "mysql2";

import { AccesoryStock } from "./models/AccesoryStock";
import { AccessoryDNS } from "./models/AccessoryDNS";
import { MaintenanceDNS } from "./models/MantenanceDNS";


const sqlDnsConfig: config = {
    user: process.env.DB_DNS_USER,
    password: process.env.DB_DNS_PASSWORD,
    server: process.env.DB_DNS_SERVER,
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

const sqlStockConfig: MySQL.ConnectionOptions = {
    host: process.env.DB_STOCK_SERVER,
    user: process.env.DB_STOCK_USER,
    password: process.env.DB_STOCK_PASSWORD,
    database: process.env.DB_STOCK_NAME,
};

const sqlStoreConfig: MySQL.ConnectionOptions = {
    host: process.env.DB_STORE_SERVER,
    user: process.env.DB_STORE_USER,
    password: process.env.DB_STORE_PASSWORD,
    database: process.env.DB_STORE_NAME,
};

const main = async (event: any, context: any) => {
    try {
        await connect(sqlDnsConfig);

        const accessories = await getAccesoriesFromDNS();
        await synchronizeAccessories(accessories);

        const maintenances = await getMaintenancesFromDNS();
        await synchronizeMaintenances(maintenances);

    } catch (error) {
        console.error(`The process can't be completed ${error}`);
    }

    process.exit(0);
}

const getAccesoriesFromDNS = async (): Promise<AccessoryDNS[]> => {
    const result = await query(`SELECT * FROM MAZKO.dbo.v_accesorios_stock;`);
    const data = result.recordset;

    const accessoriesKey: { [key: string]: AccessoryDNS } = {};

    data.map((item) => {
        const codigo = item.codigo;

        if (accessoriesKey[codigo]) {
            accessoriesKey[codigo].stock += item.stock;
            return;
        }

        accessoriesKey[codigo] = {
            bodega: item.bodega,
            desBodega: item.des_bodega,
            codigo: item.codigo,
            codigoStock: parseAccesoryCode(item.codigo),
            descripcion: item.descripcion,
            valorUnitarioSinIva: item.valor_unitario_sin_iva,
            valorConIva: item.valorconiva,
            stock: item.stock
        }
    });

    const accessories = Object.values(accessoriesKey).map((item) => item);

    return accessories;
};

const parseAccesoryCode = (codigo: string): string => {
    const reg = /^[a-zA-Z0-9]*-DIS$/;
    if (!reg.test(codigo))
        return codigo;

    return codigo.split("-DSI")[0];
};

const synchronizeAccessories = async (accessories: AccessoryDNS[]) => {
    console.log(`Syncronizing accesories, quantity: ${accessories.length}`);
    const conexion = MySQL.createConnection(sqlStockConfig);

    for (let accessory of accessories) {
        try {
            console.log(`Processing the accessory: ${accessory.descripcion} - ${accessory.codigoStock}`);

            const [result] = await conexion.promise().query(`SELECT product_id, sku, stock_quantity FROM load_mazko.wp_wc_product_meta_lookup WHERE sku = ?`, [accessory.codigoStock]);
            if (!result[0])
                throw new Error(`Item not found in store database.`);

            const item: AccesoryStock = result[0];
            console.log(`Current stock: ${item.stock_quantity} -> new stock: ${accessory.stock}`);

            await conexion.promise().query(`UPDATE load_mazko.wp_wc_product_meta_lookup SET stock_quantity = ? WHERE sku = ?`, [accessory.stock, accessory.codigoStock]);

        } catch (error) {
            console.info(`The accessory: ${accessory.descripcion} - ${accessory.codigoStock} can't be updated: ${error}`);
        }
    }

    conexion.end();
};

const getMaintenancesFromDNS = async (): Promise<MaintenanceDNS[]> => {
    const result = await query(`SELECT * FROM MAZKO.dbo.v_tall_crmv_planes_mantenimiento;`)
    const data = result.recordset;

    const maintenances: MaintenanceDNS[] = data.map((item) => {
        const maintenance: MaintenanceDNS = {
            id: item["id_plan_mantenimiento_enca"],
            modelo: item["modelo"],
            ano: item["ano"],
            descripcion: item["DESCRIPCION"],
            kilometraje: item["kilometraje"],
            notas: item["notas"],
            precio: item["precio"]
        };

        return maintenance
    });

    return maintenances;
};

const synchronizeMaintenances = async (maintenances: MaintenanceDNS[]) => {
    console.log(`Syncronizing maintenances, quantity: ${maintenances.length}`);
    const conexion = MySQL.createConnection(sqlStoreConfig);

    for (let maintenance of maintenances) {
        try {
            console.log(`Processing the maintenance: ${maintenance.descripcion} - ${maintenance.id}`);
            const [result] = await conexion.promise().query(`SELECT id_dns, id, descripcion FROM store_mazko.mantenimiento WHERE id_dns = ?`, [maintenance.id]);

            if (result[0]) {
                const queryString = `UPDATE store_mazko.mantenimiento SET modelo = ?, ano = ?, descripcion = ?, kilometraje = ?, operacion = ?, precio = ? WHERE id_dns = ?`;
                const values = [maintenance.modelo, maintenance.ano, maintenance.descripcion, maintenance.kilometraje, maintenance.notas, maintenance.precio, maintenance.id];

                await conexion.promise().query(queryString, values);
            } else {
                const queryString = `INSERT INTO store_mazko.mantenimiento (modelo, ano, descripcion, kilometraje, operacion, precio, id_dns) VALUES (?, ?, ?, ?, ?, ?, ?)`;
                const values = [maintenance.modelo, maintenance.ano, maintenance.descripcion, maintenance.kilometraje, maintenance.notas, maintenance.precio, maintenance.id];

                await conexion.promise().query(queryString, values);
            }

        } catch (error) {
            console.info(`The maintenance: ${maintenance.descripcion} - ${maintenance.id} can't be updated: ${error}`)
        }

    }

};

main(null, null);