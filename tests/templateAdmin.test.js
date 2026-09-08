const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');const {createTemplateAdminService}=require('../services/templateAdminService');
test('official/community create and edit round-trip metadata, images and galleries without changing counters',async()=>{
 const db=new PGlite();try{await db.exec(fs.readFileSync('database/schema.postgres.sql','utf8'));
 await db.exec("INSERT INTO official_galleries(official_gallery_id,gallery_name) VALUES ('og','Official'); INSERT INTO community_galleries(community_gallery_id,gallery_name) VALUES ('cg','Community');");
 const pool={query:(...x)=>db.query(...x),connect:async()=>({query:(...x)=>db.query(...x),release(){}})};const service=createTemplateAdminService(pool);
 for(const type of ['official','community']){const gallery=type==='official'?'og':'cg';const created=await service.save(type,null,{template_name:'Test',description:'Initial',images:['https://example.com/image.png'],gallery_ids:[gallery],shape_categories:'round',style_categories:'pink',material_categories:'gel',topic_tags:'nails',template_object_json:'{"layers":[]}',visibility:'private',status:'inactive'});
 const detail=await service.detail(type,created.templateId);assert.equal(detail.record.visibility,'private');assert.equal(detail.record.images.length,1);assert.deepEqual(detail.record.gallery_ids,[gallery]);assert.equal(detail.record.style_categories,'pink');
 await db.query('UPDATE templates SET like_count=8 WHERE template_id=$1',[created.templateId]);
 await service.save(type,created.templateId,{template_name:'Updated',description:'Updated description',tags:'tag1,tag2',status:'active',visibility:'public',gallery_ids:[]});
 const updated=(await service.detail(type,created.templateId)).record;assert.equal(updated.template_name,'Updated');assert.equal(updated.description,'Updated description');assert.equal(updated.like_count,8);assert.equal(updated.images[0].asset_id,detail.record.images[0].asset_id);assert.deepEqual(updated.gallery_ids,[]);
 for(const key of ['template_type','design_type','status','visibility'])await assert.rejects(service.save(type,created.templateId,{[key]:''}),/required|Invalid/);
 await assert.rejects(service.detail(type==='official'?'community':'official',created.templateId),/not found/);
 await assert.rejects(service.save(type,created.templateId,{template_name:'Bad',template_object_json:'{bad'}),/JSON/);
 await assert.rejects(service.save(type,created.templateId,{images:['https://example.com/new.png'],gallery_ids:['wrong-gallery']}),/Gallery/);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM assets')).rows[0].n,type==='official'?1:2);
 assert.equal((await service.detail(type,created.templateId)).record.template_name,'Updated');
 }
 await assert.rejects(service.save('official',null,{template_name:'No image'}),/image/);
 await assert.rejects(service.save('official',null,{template_name:'Too many',images:Array(7).fill('https://example.com/a.png')}),/six/);
 }finally{await db.close();}
});
