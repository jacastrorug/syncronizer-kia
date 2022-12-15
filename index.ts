import "dotenv/config";

import { ConnectionPool } from "mssql";
import { AccessoryStock } from "./models/AccesoryStock";
import { AccessoryDNS } from "./models/AccessoryDNS";
import { PostMetaWP } from "./models/PostMetaWP";

import * as Utils from "./utils";

const main = async () => {

    try {
        console.log(`Starting syncronization in mode: ${process.env.SYNC_ENV}`);
        console.log(`Execution date: ${new Date()}`);

        const DNSConnection = await Utils.getDNSConnection();

        const accessories = await getAccesoriesFromDNS(DNSConnection);
        await syncronizeAccessories(accessories);

        console.log(`Done ✅`);
    } catch (error) {
        console.error(`The process can't completed: ${error}`)
    }

    process.exit(0);
};

const getAccesoriesFromDNS = async (DNSConnection: ConnectionPool): Promise<AccessoryDNS[]> => {

    const result = await DNSConnection.query(`SELECT * FROM ORION.dbo.v_accesorios_stock`);
    const data = result.recordset;

    const accesoriesKey: { [key: string]: AccessoryDNS } = {};

    for (let item of data) {
        const codigo = item.codigo;

        if (accesoriesKey[codigo]) {
            accesoriesKey[codigo].stock += item.stock ?? 0;
            continue;
        }

        accesoriesKey[codigo] = {
            bodega: item.bodega,
            desBodega: item.des_bodega,
            codigo: item.codigo,
            codigoStock: Utils.parseAccesoryCode(item.codigo),
            description: item.descripcion,
            valorUnitarioSinIva: item.valor_unitario_sin_iva,
            valorConIva: item.valorconiva,
            stock: item.stock
        };

    }

    const accesories = Object.values(accesoriesKey).map(item => item);

    return accesories;
};

const syncronizeAccessories = async (accessories: AccessoryDNS[]) => {
    console.log(`Syncronizing accessories, quantity: ${accessories.length}`);
    const conexion = await Utils.getStoreConnection();
    const storeDBName = Utils.getStoreDBName();
    const storeDBPrefix = Utils.getStorePrefix();

    await Utils.cleanStockAccessories(conexion);

    for (let accessory of accessories) {
        try {
            console.log(`Processing the accessory: ${accessory.description} - ${accessory.codigoStock}`);

            const [result] = await conexion.promise().query(`SELECT product_id, sku, stock_quantity, min_price, max_price FROM ${storeDBName}.${storeDBPrefix}_wc_product_meta_lookup WHERE sku = ?`, [accessory.codigoStock]);

            if (!result[0])
                throw new Error(`Item not found in store database ${accessory.codigoStock}.`);

            const [postMetaWP] = await conexion.promise().query(`SELECT * FROM ${storeDBName}.${storeDBPrefix}_postmeta WHERE meta_key = ? AND meta_value = ?`, ['_sku', accessory.codigoStock]);
            if (!postMetaWP[0])
                throw new Error(`Item not found in postmeta table: ${accessory.codigoStock}.`);

            console.log(`✅ Updating wp_wc_product_meta_lookup:`)

            const item: AccessoryStock = result[0];
            console.log(`Current stock: ${item.stock_quantity} -> new stock: ${accessory.stock}`);
            console.log(`Current min price: ${item.min_price} -> new min price: ${accessory.valorConIva}`);
            console.log(`Current max price: ${item.max_price} -> new max price: ${accessory.valorConIva}`);

            await conexion.promise().query(`UPDATE ${storeDBName}.${storeDBPrefix}_wc_product_meta_lookup SET stock_quantity = ?, min_price = ?, max_price = ? WHERE sku = ?`, [accessory.stock, accessory.valorConIva, accessory.valorConIva, accessory.codigoStock]);

            console.log(`✅ Updating wp_postmeta:`);
            const postMeta: PostMetaWP = postMetaWP[0];

            const [resultPostMetas] = await conexion.promise().query(`SELECT * FROM ${storeDBName}.${storeDBPrefix}_postmeta WHERE post_id = ? AND meta_key IN (?, ?, ?, ?, ?)`, [postMeta.post_id, '_sku', '_stock', '_regular_price', '_price', '_manage_stock']);
            const postMetasWP = resultPostMetas as PostMetaWP[];
            for (let idx = 0; idx < postMetasWP.length; idx++) {
                console.log(`Meta key: ${postMetasWP[idx].meta_key} - Meta Value: ${postMetasWP[idx].meta_value}`);
            }

            await conexion.promise().query(`UPDATE ${storeDBName}.${storeDBPrefix}_postmeta SET meta_value = ? WHERE meta_key = ? AND post_id = ?`, [accessory.valorConIva, '_regular_price', postMeta.post_id]);
            await conexion.promise().query(`UPDATE ${storeDBName}.${storeDBPrefix}_postmeta SET meta_value = ? WHERE meta_key = ? AND post_id = ?`, [accessory.valorConIva, '_price', postMeta.post_id]);
            await conexion.promise().query(`UPDATE ${storeDBName}.${storeDBPrefix}_postmeta SET meta_value = ? WHERE meta_key = ? AND post_id = ?`, [accessory.stock, '_stock', postMeta.post_id]);
            await conexion.promise().query(`UPDATE ${storeDBName}.${storeDBPrefix}_postmeta SET meta_value = ? WHERE meta_key = ? AND post_id = ?`, ['yes', '_manage_stock', postMeta.post_id]);

        } catch (error) {
            console.info(`The accessory: ${accessory.description} - ${accessory.codigoStock} can't be updated: ${error}`);
        }

    }

    conexion.end();
};

main();
