const crypto=require('node:crypto');
const FIELDS=['template_name','template_title','description','template_type','design_type','nail_shape','material_type','shape_categories','style_categories','material_categories','topic_tags','tags','author_user_id','author_display_name','author_avatar_asset_id','author_level','event_id','template_object_json','visibility','status','published_at'];
function source(value){if(!['official','community'].includes(value))throw new Error('Invalid template source');return value;}
function createTemplateRepository(pool){
 async function transaction(fn){const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
 async function get(c,type,id,lock=false){source(type);return (await c.query(`SELECT * FROM templates WHERE template_id=$1 AND source_type=$2${lock?' FOR UPDATE':''}`,[id,type])).rows[0];}
 async function galleries(c,type){source(type);const table=type==='official'?'official_galleries':'community_galleries',key=type==='official'?'official_gallery_id':'community_gallery_id';return(await c.query(`SELECT ${key} AS id,gallery_name AS name FROM ${table} ORDER BY gallery_name`)).rows;}
 async function assets(c,ids){return ids.length?(await c.query('SELECT asset_id,url,mime_type,base64_data FROM assets WHERE asset_id=ANY($1::text[])',[ids])).rows:[];}
 async function save(c,type,id,values,existing){const cols=Object.keys(values).filter(k=>FIELDS.includes(k)||['cover_asset_id','image_asset_id','image_asset_ids'].includes(k));const args=cols.map(k=>values[k]);
 if(existing){return(await c.query(`UPDATE templates SET ${cols.map((k,i)=>`${k}=$${i+1}`).join(',')},updated_at=CURRENT_TIMESTAMP WHERE template_id=$${args.length+1} AND source_type=$${args.length+2} RETURNING *`,[...args,id,type])).rows[0];}
 return(await c.query(`INSERT INTO templates(template_id,source_type,${cols.join(',')}) VALUES ($1,$2,${args.map((_,i)=>'$'+(i+3)).join(',')}) RETURNING *`,[id,type,...args])).rows[0];}
 async function image(c,owner,data){const id='asset_'+crypto.randomUUID().replace(/-/g,'');await c.query("INSERT INTO assets(asset_id,owner_user_id,asset_type,mime_type,url,base64_data) VALUES ($1,$2,'template-image',$3,$4,$5)",[id,owner,data.mime||null,data.url||'',data.base64||'']);return id;}
 async function link(c,type,id,galleryIds,owner){await c.query('DELETE FROM gallery_templates WHERE template_id=$1 AND gallery_type=$2',[id,type]);for(const gallery of galleryIds)await c.query('INSERT INTO gallery_templates(gallery_template_id,gallery_type,gallery_id,template_id,user_id) VALUES ($1,$2,$3,$4,$5)',['gt_'+crypto.randomUUID(),type,gallery,id,owner]);}
 return {transaction,get,galleries,assets,save,image,link,query:(...args)=>pool.query(...args)};
}
module.exports={createTemplateRepository,FIELDS,source};
