'use strict'

const report = require('./protocol-775-packets.json')

const decodedPlayPackets = new Set([
  'kick_disconnect',
  'keep_alive',
  'login',
  'death_combat_event',
  'entity_destroy',
  'entity_equipment',
  'entity_move_look',
  'entity_teleport',
  'position',
  'rel_entity_move',
  'set_slot',
  'spawn_entity',
  'start_configuration',
  'sync_entity_position',
  'update_health',
  'window_items'
])

const customPacketTypes = {
  play: {
    toServer: {
      attack: [
        'container',
        [
          { name: 'target', type: 'varint' }
        ]
      ]
    }
  }
}

const aliases = {
  configuration: {
    toClient: {
      resource_pack_pop: 'remove_resource_pack',
      resource_pack_push: 'add_resource_pack',
      update_enabled_features: 'feature_flags',
      update_tags: 'tags'
    },
    toServer: {
      client_information: 'settings',
      resource_pack: 'resource_pack_receive'
    }
  },
  play: {
    toClient: {
      add_entity: 'spawn_entity',
      animate: 'animation',
      award_stats: 'statistics',
      block_changed_ack: 'acknowledge_player_digging',
      block_destruction: 'block_break_animation',
      block_entity_data: 'tile_entity_data',
      block_event: 'block_action',
      block_update: 'block_change',
      boss_event: 'boss_bar',
      change_difficulty: 'difficulty',
      chunks_biomes: 'chunk_biomes',
      command_suggestions: 'tab_complete',
      commands: 'declare_commands',
      container_close: 'close_window',
      container_set_content: 'window_items',
      container_set_data: 'craft_progress_bar',
      container_set_slot: 'set_slot',
      cooldown: 'set_cooldown',
      custom_chat_completions: 'chat_suggestions',
      'debug/block_value': 'debug_block_value',
      'debug/chunk_value': 'debug_chunk_value',
      'debug/entity_value': 'debug_entity_value',
      'debug/event': 'debug_event',
      delete_chat: 'hide_message',
      disconnect: 'kick_disconnect',
      disguised_chat: 'profileless_chat',
      entity_event: 'entity_status',
      entity_position_sync: 'sync_entity_position',
      explode: 'explosion',
      forget_level_chunk: 'unload_chunk',
      game_event: 'game_state_change',
      initialize_border: 'initialize_world_border',
      level_chunk_with_light: 'map_chunk',
      level_event: 'world_event',
      level_particles: 'world_particles',
      light_update: 'update_light',
      map_item_data: 'map',
      merchant_offers: 'trade_list',
      mount_screen_open: 'open_horse_window',
      move_entity_pos: 'rel_entity_move',
      move_entity_pos_rot: 'entity_move_look',
      move_entity_rot: 'entity_look',
      move_minecart_along_track: 'move_minecart',
      move_vehicle: 'vehicle_move',
      open_screen: 'open_window',
      open_sign_editor: 'open_sign_entity',
      place_ghost_recipe: 'craft_recipe_response',
      player_abilities: 'abilities',
      player_combat_end: 'end_combat_event',
      player_combat_enter: 'enter_combat_event',
      player_combat_kill: 'death_combat_event',
      player_info_remove: 'player_remove',
      player_info_update: 'player_info',
      player_look_at: 'face_player',
      player_position: 'position',
      pong_response: 'ping_response',
      projectile_power: 'set_projectile_power',
      remove_entities: 'entity_destroy',
      remove_mob_effect: 'remove_entity_effect',
      resource_pack_pop: 'remove_resource_pack',
      resource_pack_push: 'add_resource_pack',
      rotate_head: 'entity_head_rotation',
      section_blocks_update: 'multi_block_change',
      select_advancements_tab: 'select_advancement_tab',
      set_action_bar_text: 'action_bar',
      set_border_center: 'world_border_center',
      set_border_lerp_size: 'world_border_lerp_size',
      set_border_size: 'world_border_size',
      set_border_warning_delay: 'world_border_warning_delay',
      set_border_warning_distance: 'world_border_warning_reach',
      set_camera: 'camera',
      set_chunk_cache_center: 'update_view_position',
      set_chunk_cache_radius: 'update_view_distance',
      set_default_spawn_position: 'spawn_position',
      set_display_objective: 'scoreboard_display_objective',
      set_entity_data: 'entity_metadata',
      set_entity_link: 'attach_entity',
      set_entity_motion: 'entity_velocity',
      set_equipment: 'entity_equipment',
      set_experience: 'experience',
      set_health: 'update_health',
      set_held_slot: 'held_item_slot',
      set_objective: 'scoreboard_objective',
      set_player_team: 'teams',
      set_score: 'scoreboard_score',
      set_simulation_distance: 'simulation_distance',
      set_subtitle_text: 'set_title_subtitle',
      set_time: 'update_time',
      set_titles_animation: 'set_title_time',
      sound: 'sound_effect',
      sound_entity: 'entity_sound_effect',
      tab_list: 'playerlist_header',
      tag_query: 'nbt_query_response',
      take_item_entity: 'collect',
      teleport_entity: 'entity_teleport',
      ticking_state: 'set_ticking_state',
      ticking_step: 'step_tick',
      update_advancements: 'advancements',
      update_attributes: 'entity_update_attributes',
      update_mob_effect: 'entity_effect',
      update_recipes: 'declare_recipes',
      update_tags: 'tags',
      waypoint: 'tracked_waypoint'
    },
    toServer: {
      accept_teleportation: 'teleport_confirm',
      block_entity_tag_query: 'query_block_nbt',
      bundle_item_selected: 'select_bundle_item',
      change_difficulty: 'set_difficulty',
      change_game_mode: 'change_gamemode',
      chat: 'chat_message',
      chat_ack: 'message_acknowledgement',
      client_information: 'settings',
      client_tick_end: 'tick_end',
      command_suggestion: 'tab_complete',
      container_button_click: 'enchant_item',
      container_click: 'window_click',
      container_close: 'close_window',
      container_slot_state_changed: 'set_slot_state',
      entity_tag_query: 'query_entity_nbt',
      interact: 'use_entity',
      jigsaw_generate: 'generate_structure',
      move_player_pos: 'position',
      move_player_pos_rot: 'position_look',
      move_player_rot: 'look',
      move_player_status_only: 'flying',
      move_vehicle: 'vehicle_move',
      paddle_boat: 'steer_boat',
      place_recipe: 'craft_recipe_request',
      player_abilities: 'abilities',
      player_action: 'block_dig',
      player_command: 'entity_action',
      recipe_book_change_settings: 'recipe_book',
      recipe_book_seen_recipe: 'displayed_recipe',
      rename_item: 'name_item',
      resource_pack: 'resource_pack_receive',
      seen_advancements: 'advancement_tab',
      set_beacon: 'set_beacon_effect',
      set_carried_item: 'held_item_slot',
      set_command_block: 'update_command_block',
      set_command_minecart: 'update_command_block_minecart',
      set_creative_mode_slot: 'set_creative_slot',
      set_jigsaw_block: 'update_jigsaw_block',
      set_structure_block: 'update_structure_block',
      sign_update: 'update_sign',
      spectate_entity: 'spectate',
      swing: 'arm_animation',
      teleport_to_entity: 'spectate',
      use_item_on: 'block_place'
    }
  }
}

module.exports = function createProtocol775Packets(mcData) {
  const custom = { [mcData.version.majorVersion]: {} }

  for (const [state, directions] of Object.entries({
    configuration: { toClient: 'clientbound', toServer: 'serverbound' },
    play: { toClient: 'clientbound', toServer: 'serverbound' }
  })) {
    custom[mcData.version.majorVersion][state] = {}

    for (const [direction, reportDirection] of Object.entries(directions)) {
      const baseTypes = mcData.protocol[state][direction].types
      const knownNames = new Set(Object.values(baseTypes.packet[1][0].type[1].mappings))
      const mappings = {}
      const types = {}
      const unknownFields = {}

      for (const [resourceName, packet] of Object.entries(report[state][reportDirection])) {
        const officialName = resourceName.slice('minecraft:'.length)
        const alias = aliases[state]?.[direction]?.[officialName] || officialName
        const customPacketType = customPacketTypes[state]?.[direction]?.[officialName]
        const decodeKnownPacket =
          knownNames.has(alias) &&
          (state !== 'play' || direction !== 'toClient' || decodedPlayPackets.has(alias))
        const name = decodeKnownPacket || customPacketType ? alias : unknownName(officialName)

        mappings[`0x${packet.protocol_id.toString(16).padStart(2, '0')}`] = name
        if (customPacketType) {
          types[`packet_${name}`] = customPacketType
          unknownFields[name] = `packet_${name}`
        } else if (!decodeKnownPacket) {
          types[`packet_${name}`] = ['container', [{ name: 'data', type: 'restBuffer' }]]
          unknownFields[name] = `packet_${name}`
        }
      }

      types.packet = [
        'container',
        [
          {
            name: 'name',
            type: ['mapper', { type: 'varint', mappings }]
          },
          {
            name: 'params',
            type: ['switch', { compareTo: 'name', fields: unknownFields }]
          }
        ]
      ]

      custom[mcData.version.majorVersion][state][direction] = { types }
    }
  }

  return custom
}

function unknownName(name) {
  return `protocol_775_${name.replaceAll('/', '_')}`
}
