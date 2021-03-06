var run = false;
var verbose_logging = false;
var bios_load = false;
var game_load = false;
var boot_complete = false;

var FLAG_Z = 0x80;
var FLAG_N = 0x40;
var FLAG_H = 0x20;
var FLAG_C = 0x10;

var INT_HILO = 0x10;
var INT_SEIO = 0x08;
var INT_TIMO = 0x04;
var INT_LCDC = 0x02;
var INT_VBLK = 0x01;

var EMI = false;
var IF_ADR = 0xFF0F;
var IE_ADR = 0xFFFF;

var LY_ADR = 0xFF44;

var registers = {};
var last_instr_str = "foo";
var call_depth = "";

var loop_cpuinterval;
var loop_gpuinterval;

var game_temp = new Array(0x100);
var memory = new Array(0x10000);

var screen_2d;
var pixel;

window.onload = page_init;

function page_init()
{
	for(var i = 0; i <= 0xFFFF; i++)
	{
		memory[i] = 0x00;
	}

	// vsync hack
	memory[0xFF44] = 0x90;

	var screen = document.getElementById("screen");
	screen_2d = screen.getContext("2d");
	pixel = screen_2d.createImageData(1,1);

	pixel.data[0] = 0;
	pixel.data[1] = 0;
	pixel.data[2] = 0;
	pixel.data[3] = 0xFF;
	
	document.getElementById("bios_file").addEventListener('change', handle_biosfile_event, false);
	document.getElementById("game_file").addEventListener('change', handle_gamefile_event, false);
	document.getElementById("start_button").addEventListener('click', handle_startbutton_event);
};

function handle_biosfile_event(evt)
{
	var bios_file = evt.target.files[0];
	
	if(bios_file)
	{
		var bios_reader = new FileReader();
		bios_reader.onload = function(e)
		{
			var bin_string = e.target.result;
			document.getElementById("boot_size").innerHTML = "0x" + bin_string.length.toString(16);
			var str = "";
			for(var i = 0; i < bin_string.length; i++)
			{
				var char = bin_string.charCodeAt(i);
				memory[i] = (char & 0xFF);
			}
			bios_load = true;
		}
		bios_reader.readAsBinaryString(bios_file);
	}
	else
	{
		alert("Failed to load file!");
	}
};

function handle_gamefile_event(evt)
{
	var game_file = evt.target.files[0];
	
	if(game_file)
	{
		var game_reader = new FileReader();
		game_reader.onload = function(e)
		{
			var bin_string = e.target.result;
			document.getElementById("rom_size").innerHTML = "0x" + bin_string.length.toString(16);
			for(var i = 0; i < Math.min(0xFF, bin_string.length); i++)
			{
				var char = bin_string.charCodeAt(i);
				game_temp[i] = (char & 0xFF);
			}
			for(var i = 0x100; i < Math.min(0x8000, bin_string.length); i++)
			{
				var char = bin_string.charCodeAt(i);
				memory[i] = (char & 0xFF);
			}
			game_load = true;
		}
		game_reader.readAsBinaryString(game_file);
	}
	else
	{
		alert("Failed to load file!");
	}
};

function handle_startbutton_event(evt)
{
	if(!bios_load)
		alert("Warning, no bootstrap ROM loaded! Currently required for emulation...");
	if(!game_load)
		alert("Warning, no game ROM loaded! Bootstrap ROM will lock up...");
	
	cpu_init();
	loop_cpuinterval = setInterval(cpu_loop, 1);
	loop_gpuinterval = setInterval(draw_screen, 40);
};

function cpu_init()
{
	registers["A"] = 0x00;
	registers["B"] = 0x00;
	registers["C"] = 0x00;
	registers["D"] = 0x00;
	registers["E"] = 0x00;
	registers["H"] = 0x00;
	registers["L"] = 0x00;
	registers["F"] = 0x00;
	registers["SP"] = 0x00;
	registers["PC"] = 0x00;
	run = true;
}

function draw_screen()
{
	var pl1, pl2, pl, t, i;
	var screen_x;
	screen_2d.fillStyle="#333333";
	
	if(memory[0xFF40] != 0)
	{
		screen_2d.fillStyle="#FFFFFF";
	}
	screen_2d.fillRect(0, 0, 160, 140);
	
	if(memory[0xFF40] != 0)
	{
		for(var tile_y = 0; tile_y < 18; ++tile_y)
		{
			for(var tile_x = 0; tile_x < 20; ++tile_x)
			{
				var tile_id = memory[0x9800 + 32 * (tile_y + memory[0xFF42]) + tile_x + memory[0xFF43]];
				for(var py = 0; py < 8; ++py)
				{
					var pl1 = memory[0x8000 + 16 * tile_id + 2 * py];
					var pl2 = memory[0x8000 + 16 * tile_id + 2 * py + 1];
					var pl = pl1 | pl2;
					for(var px = 0; px < 8; ++px)
					{
						if((pl & (0x80 >> px)) != 0)
							screen_2d.putImageData(pixel, tile_x * 8 + px, tile_y * 8 + py);
					}
				}
			}
		}
		
	}
	document.getElementById("out_af").innerHTML= "0x" + ((registers["A"] << 8) | registers["F"]).toString(16);
	document.getElementById("out_bc").innerHTML= "0x" + ((registers["B"] << 8) | registers["C"]).toString(16);
	document.getElementById("out_de").innerHTML= "0x" + ((registers["D"] << 8) | registers["E"]).toString(16);
	document.getElementById("out_hl").innerHTML= "0x" + ((registers["H"] << 8) | registers["L"]).toString(16);
	document.getElementById("out_sp").innerHTML= "0x" + registers["SP"].toString(16);
	document.getElementById("out_pc").innerHTML= "0x" + registers["PC"].toString(16);
}

function cpu_cycle()
{
	if(!boot_complete && memory[0xFF50] != 0x00)
	{
		boot_complete = true;
		document.getElementById("console").innerHTML = "Booting complete.";
		for(var i = 0; i < 0xFF; ++i)
		{
			memory[i] = game_temp[i];
		}
	}
	
	var instr = memory[registers["PC"]++];
	if(instr !== undefined)
	{
		last_instr_str = call_depth + " Executing [0x" + (registers["PC"]-1).toString(16) + "]: 0x" + instr.toString(16) + ": ";
	}
	
	var arg1 = memory[registers["PC"]];
	var arg2 = memory[registers["PC"]+1];
	
	switch(instr)
	{
		case 0x00:  last_instr_str += "NOP";										break;
		case 0x01:	cpu_load_reg16_nn("B", "C", arg1, arg2);	registers["PC"]+=2;	break;
		case 0x02:	cpu_load_reg16_reg("B", "C", "A");			break;
		case 0x03:  cpu_inc_reg16("B", "C");	break;
		case 0x04:  cpu_inc_reg("B");			break;
		case 0x05:	cpu_dec_reg("B");			break;
		case 0x06:  cpu_load_reg_n("B", arg1);					registers["PC"]+=1;	break;
		case 0x07:  cpu_rlca();					break;
		case 0x08:  cpu_load_nn_sp(arg1, arg2);					registers["PC"]+=2; break;
		case 0x09:  cpu_add_hl_reg16("B", "C");					break;
		case 0x0A:	cpu_load_reg_reg16("A", "B", "C");			break;
		case 0x0B:  cpu_dec_reg16("B", "C");	break;
		case 0x0C:  cpu_inc_reg("C");			break;
		case 0x0D:	cpu_dec_reg("C");			break;
		case 0x0E:  cpu_load_reg_n("C", arg1);					registers["PC"]+=1;	break;
		case 0x0F:  cpu_rrca();					break;
	//	case 0x10:  STOP
		case 0x11:	cpu_load_reg16_nn("D", "E", arg1, arg2);	registers["PC"]+=2;	break;
		case 0x12:	cpu_load_reg16_reg("D", "E", "A");			break;
		case 0x13:  cpu_inc_reg16("D", "E");	break;
		case 0x14:  cpu_inc_reg("D");			break;
		case 0x15:	cpu_dec_reg("D");			break;
		case 0x16:  cpu_load_reg_n("D", arg1);					registers["PC"]+=1;	break;
		case 0x17:	cpu_rla();					break;
		case 0x18:	cpu_jumpr(arg1);							registers["PC"]+=1;	break;
		case 0x19:  cpu_add_hl_reg16("D", "E");					break;
		case 0x1A:	cpu_load_reg_reg16("A", "D", "E");			break;
		case 0x1B:  cpu_dec_reg16("D", "E");	break;
		case 0x1C:  cpu_inc_reg("D");			break;
		case 0x1D:	cpu_dec_reg("E");			break;
		case 0x1E:  cpu_load_reg_n("E", arg1);					registers["PC"]+=1;	break;
		case 0x1F:  cpu_rra();					break;
		case 0x20:	cpu_jumpr_c(false, FLAG_Z, arg1);			registers["PC"]+=1;	break;
		case 0x21:	cpu_load_reg16_nn("H", "L", arg1, arg2);	registers["PC"]+=2;	break;
		case 0x22:	cpu_loadi_hl_a();												break;
		case 0x23:  cpu_inc_reg16("H", "L");	break;
		case 0x24:  cpu_inc_reg("H");			break;
		case 0x25:	cpu_dec_reg("H");			break;
		case 0x26:  cpu_load_reg_n("H", arg1);					registers["PC"]+=1;	break;
		case 0x28:	cpu_jumpr_c(true, FLAG_Z, arg1);			registers["PC"]+=1;	break;
		case 0x29:  cpu_add_hl_reg16("D", "E");					break;
		case 0x2A:  cpu_loadi_a_hl();			break;
		case 0x2B:  cpu_dec_reg16("H", "L");	break;
		case 0x2C:  cpu_inc_reg("L");			break;
		case 0x2D:	cpu_dec_reg("L");			break;
		case 0x2E:  cpu_load_reg_n("L", arg1);					registers["PC"]+=1;	break;
		case 0x2F:  cpu_cpl();					break;
		case 0x30:  cpu_jumpr_c(false, FLAG_C, arg1);			registers["PC"]+=1;	break;
		case 0x31:	cpu_load_sp_nn(arg1, arg2);					registers["PC"]+=2;	break;
		case 0x32:	cpu_loadd_hl_a();												break;
		case 0x33:  cpu_inc_sp();				break;
		case 0x34:  cpu_inc_hl();				break;
		case 0x35:  cpu_dec_hl();				break;
		case 0x36:  cpu_load_hl_n(arg1);						registers["PC"]+=1;	break;
	//	case 0x37:  removed SCF
		case 0x38:  cpu_jumpr_c(true, FLAG_C, arg1);			registers["PC"]+=1;	break;
		case 0x39:  cpu_add_hl_sp();			break;
		case 0x3A:  cpu_loadd_a_hl();			break;
		case 0x3B:  cpu_dec_sp();				break;
		case 0x3C:  cpu_inc_reg("A");			break;
		case 0x3D:	cpu_dec_reg("A");			break;
		case 0x3E:	cpu_load_reg_n("A", arg1);					registers["PC"]+=1;	break;
		case 0x40:  cpu_load_reg_reg("B", "B");	break;
		case 0x41:  cpu_load_reg_reg("B", "C");	break;
		case 0x42:  cpu_load_reg_reg("B", "D");	break;
		case 0x43:  cpu_load_reg_reg("B", "E");	break;
		case 0x44:  cpu_load_reg_reg("B", "H");	break;
		case 0x45:  cpu_load_reg_reg("B", "L");	break;
		case 0x46:	cpu_load_reg_reg16("B", "H", "L");			break;
		case 0x47:  cpu_load_reg_reg("B", "A"); break;
		case 0x48:  cpu_load_reg_reg("C", "B");	break;
		case 0x49:  cpu_load_reg_reg("C", "C");	break;
		case 0x4A:  cpu_load_reg_reg("C", "D");	break;
		case 0x4B:  cpu_load_reg_reg("C", "E");	break;
		case 0x4C:  cpu_load_reg_reg("C", "H");	break;
		case 0x4D:  cpu_load_reg_reg("C", "L");	break;
		case 0x4E:	cpu_load_reg_reg16("C", "H", "L");			break;
		case 0x4F:  cpu_load_reg_reg("C", "A"); break;
		case 0x50:  cpu_load_reg_reg("D", "B");	break;
		case 0x51:  cpu_load_reg_reg("D", "C");	break;
		case 0x52:  cpu_load_reg_reg("D", "D");	break;
		case 0x53:  cpu_load_reg_reg("D", "E");	break;
		case 0x54:  cpu_load_reg_reg("D", "H");	break;
		case 0x55:  cpu_load_reg_reg("D", "L");	break;
		case 0x56:	cpu_load_reg_reg16("D", "H", "L");			break;
		case 0x57:  cpu_load_reg_reg("D", "A"); break;
		case 0x58:  cpu_load_reg_reg("E", "B");	break;
		case 0x59:  cpu_load_reg_reg("E", "C");	break;
		case 0x5A:  cpu_load_reg_reg("E", "D");	break;
		case 0x5B:  cpu_load_reg_reg("E", "E");	break;
		case 0x5C:  cpu_load_reg_reg("E", "H");	break;
		case 0x5D:  cpu_load_reg_reg("E", "L");	break;
		case 0x5E:	cpu_load_reg_reg16("E", "H", "L");			break;
		case 0x5F:  cpu_load_reg_reg("E", "A"); break;
		case 0x60:  cpu_load_reg_reg("H", "B");	break;
		case 0x61:  cpu_load_reg_reg("H", "C");	break;
		case 0x62:  cpu_load_reg_reg("H", "D");	break;
		case 0x63:  cpu_load_reg_reg("H", "E");	break;
		case 0x64:  cpu_load_reg_reg("H", "H");	break;
		case 0x65:  cpu_load_reg_reg("H", "L");	break;
		case 0x66:	cpu_load_reg_reg16("H", "H", "L");			break;
		case 0x67:  cpu_load_reg_reg("H", "A"); break;
		case 0x68:  cpu_load_reg_reg("L", "B");	break;
		case 0x69:  cpu_load_reg_reg("L", "C");	break;
		case 0x6A:  cpu_load_reg_reg("L", "D");	break;
		case 0x6B:  cpu_load_reg_reg("L", "E");	break;
		case 0x6C:  cpu_load_reg_reg("L", "H");	break;
		case 0x6D:  cpu_load_reg_reg("L", "L");	break;
		case 0x6E:	cpu_load_reg_reg16("L", "H", "L");			break;
		case 0x6F:  cpu_load_reg_reg("L", "A"); break;
		case 0x70:	cpu_load_reg16_reg("H", "L", "B");			break;
		case 0x71:	cpu_load_reg16_reg("H", "L", "C");			break;
		case 0x72:	cpu_load_reg16_reg("H", "L", "D");			break;
		case 0x73:	cpu_load_reg16_reg("H", "L", "E");			break;
		case 0x74:	cpu_load_reg16_reg("H", "L", "H");			break;
		case 0x75:	cpu_load_reg16_reg("H", "L", "L");			break;
		case 0x77:	cpu_load_reg16_reg("H", "L", "A");			break;
		case 0x78:  cpu_load_reg_reg("A", "B");	break;
		case 0x79:  cpu_load_reg_reg("A", "C");	break;
		case 0x7A:  cpu_load_reg_reg("A", "D");	break;
		case 0x7B:  cpu_load_reg_reg("A", "E");	break;
		case 0x7C:  cpu_load_reg_reg("A", "H");	break;
		case 0x7D:  cpu_load_reg_reg("A", "L");	break;
		case 0x7E:	cpu_load_reg_reg16("A", "H", "L");			break;
		case 0x7F:  cpu_load_reg_reg("A", "A");	break;
		case 0x80:	cpu_add_reg("B");			break;
		case 0x81:	cpu_add_reg("C");			break;
		case 0x82:	cpu_add_reg("D");			break;
		case 0x83:	cpu_add_reg("E");			break;
		case 0x84:	cpu_add_reg("H");			break;
		case 0x85:	cpu_add_reg("L");			break;
		case 0x86:	cpu_add_hl();				break;
		case 0x87:	cpu_add_reg("A");			break;
		case 0x90:  cpu_sub_reg("B");			break;
		case 0x91:  cpu_sub_reg("C");			break;
		case 0x92:  cpu_sub_reg("D");			break;
		case 0x93:  cpu_sub_reg("E");			break;
		case 0x94:  cpu_sub_reg("H");			break;
		case 0x95:  cpu_sub_reg("L");			break;
		case 0x96:  cpu_sub_hl();				break;
		case 0x97:  cpu_sub_reg("A");			break;
		
		case 0xA0:	cpu_and_reg("B");			break;
		case 0xA1:	cpu_and_reg("C");			break;
		case 0xA2:	cpu_and_reg("D");			break;
		case 0xA3:	cpu_and_reg("E");			break;
		case 0xA4:	cpu_and_reg("H");			break;
		case 0xA5:	cpu_and_reg("L");			break;
		case 0xA6:	cpu_and_hl();				break;
		case 0xA7:	cpu_and_reg("A");			break;
		case 0xA8:	cpu_xor_reg("B");			break;
		case 0xA9:	cpu_xor_reg("C");			break;
		case 0xAA:	cpu_xor_reg("D");			break;
		case 0xAB:	cpu_xor_reg("E");			break;
		case 0xAC:	cpu_xor_reg("H");			break;
		case 0xAD:	cpu_xor_reg("L");			break;
		case 0xAE:	cpu_xor_hl();				break;
		case 0xAF:	cpu_xor_reg("A");			break;
		case 0xB0:	cpu_or_reg("B");			break;
		case 0xB1:	cpu_or_reg("C");			break;
		case 0xB2:	cpu_or_reg("D");			break;
		case 0xB3:	cpu_or_reg("E");			break;
		case 0xB4:	cpu_or_reg("H");			break;
		case 0xB5:	cpu_or_reg("L");			break;
		case 0xB6:	cpu_or_hl();				break;
		case 0xB7:	cpu_or_reg("A");			break;
		case 0xB8:  cpu_cp_reg("B");							break;
		case 0xB9:  cpu_cp_reg("C");							break;
		case 0xBA:  cpu_cp_reg("D");							break;
		case 0xBB:  cpu_cp_reg("E");							break;
		case 0xBC:  cpu_cp_reg("H");							break;
		case 0xBD:  cpu_cp_reg("L");							break;
		case 0xBE:  cpu_cp_hl();								break;
		case 0xBF:  cpu_cp_reg("A");							break;
		case 0xC1:	cpu_pop("B", "C");							break;
		case 0xC3:  cpu_jump(arg1, arg2);						break;
		case 0xC5:	cpu_push("B", "C");							break;
		case 0xC8:  cpu_ret_c(true, FLAG_Z);					break;
		case 0xC9:	cpu_ret();									break;
		case 0xCD:	registers["PC"]+=2;	cpu_call(arg1, arg2);	break;
		case 0xD1:	cpu_pop("D", "E");							break;
		case 0xD5:	cpu_push("D", "E");							break;
		case 0xD6:  cpu_sub_n(arg1);		registers["PC"]+=1;	break;
	//	case 0xDA:  removed OUTA(byte)
	//	case 0xD9:  RETI
	//  case 0xDB:  removed INA(byte)
	//  case 0xDD:  removed DD prefix
		case 0xE0:	cpu_loadh_n_a(arg1);	registers["PC"]+=1;	break;
		case 0xE1:	cpu_pop("H", "L");							break;
		case 0xE2:	cpu_load_c_a();								break;
		case 0xE5:	cpu_push("H", "L");							break;
		case 0xE6:	cpu_and_n(arg1);		registers["PC"]+=1;	break;
		case 0xEA:	cpu_load_nn_reg(arg1, arg2, "A");	registers["PC"]+=2;	break;
		case 0xEE:	cpu_xor_n(arg1);		registers["PC"]+=1;	break;
	//  case 0xBE:  removed EX DE,HL
	//  case 0xEC:  removed JP PE,word
		case 0xF0:	cpu_loadh_a_n(arg1);	registers["PC"]+=1;	break;
		case 0xF1:	cpu_pop("A", "F");							break;
	//  case 0xF2:  removed JP P,word
		case 0xF3:	cpu_di();									break;
	//  case 0xF4:  removed CALL P,word
		case 0xF5:	cpu_push("A", "F");							break;
		case 0xF6:	cpu_or_n(arg1);			registers["PC"]+=1;	break;
	//  case 0xF8:  LDHL SP,offset
	//  case 0xFA:  LD A,(word)
		case 0xFB:	cpu_ei();									break;
	//  case 0xFC:  removed CALL M,word
	//  case 0xFD:  removed FD prefix
		case 0xFE:	cpu_cp_n(arg1);			registers["PC"]+=1;	break;	



		case 0xCB:	last_instr_str += "(ext) 0x" + arg1.toString(16) + ": ";
					switch(arg1)
					{
						case 0x11:	cpu_rl_reg("C");	break;
						default:
							switch(arg1 & 0x47)
							{
								case 0x47:  cpu_bitr(((arg1 & 0x38) >> 3), "A");	break;
								case 0x40:  cpu_bitr(((arg1 & 0x38) >> 3), "B");	break;
								case 0x41:  cpu_bitr(((arg1 & 0x38) >> 3), "C");	break;
								case 0x42:  cpu_bitr(((arg1 & 0x38) >> 3), "D");	break;
								case 0x43:  cpu_bitr(((arg1 & 0x38) >> 3), "E");	break;
								case 0x44:  cpu_bitr(((arg1 & 0x38) >> 3), "H");	break;
								case 0x45:  cpu_bitr(((arg1 & 0x38) >> 3), "L");	break;
								//case 0x46:  cpu_bitrhl(((einstr & 0x38) >> 3));	break;
								default:	alert("Invalid 0xCB operation...");		break;
							}
					}
					registers["PC"]+=1;
					break;
		
		default:	document.getElementById("error").innerHTML = "Error: unknown upcode 0x" + instr.toString(16) + " at 0x" + (registers["PC"]-1).toString(16);
					run = false;
					stack_trace();
					mem_dump();
					last_instr_str += "???";
					clearInterval(loop_cpuinterval);
					clearInterval(loop_gpuinterval);
					break;
	}
	
	
	document.getElementById("last_instr").innerHTML = last_instr_str;
	if(verbose_logging)
	{
		var con_lnode = document.createElement("li");
		var con_tnode = document.createTextNode(last_instr_str);
		con_lnode.appendChild(con_tnode);
		document.getElementById("console").appendChild(con_lnode);
	}
	
	// More vsync hacks... :(
	memory[LY_ADR] = (memory[LY_ADR] == 0x90 ? 0x94 : 0x90);
}

function cpu_load_reg16_nn(desth, destl, srcl, srch)
{
	var temp = (((srch & 0xFF) << 8) | (srcl & 0xFF)) & 0xFFFF;
	last_instr_str += "LD " + desth + destl + ", 0x" + temp.toString(16);
	registers[destl] = (srcl & 0xFF);
	registers[desth] = (srch & 0xFF);
}

function cpu_load_sp_nn(srcl, srch)
{
	var temp = (((srch & 0xFF) << 8) | (srcl & 0xFF)) & 0xFFFF;
	last_instr_str += "LD SP, 0x" + temp.toString(16);
	registers["SP"] = temp;
}

function cpu_load_nn_sp(srcl, srch)
{
	var temp = (((srch & 0xFF) << 8) | (srcl & 0xFF)) & 0xFFFF;
	last_instr_str += "LD 0x" + temp.toString(16) + " SP";
	memory[temp] = registers["SP"];
}

function cpu_load_reg_reg(dest, src)
{
	last_instr_str += "LD " + dest + ", " + src;
	registers[dest] = registers[src];
}

function cpu_load_reg_n(dest, src)
{
	last_instr_str += "LD " + dest + ", 0x" + src.toString(16);
	registers[dest] = src;
}

function cpu_load_hl_n(src)
{
	var adr = (((registers["H"] & 0xFF) << 8) | (registers["L"] & 0xFF)) & 0xFFFF;
	last_instr_str += "LD (HL), 0x" + src.toString(16);
	memory[adr] = (src & 0xFF);
}

function cpu_load_c_a()
{
	last_instr_str += "LD (0xFF00 + C), A";
	memory[0xFF00 + registers["C"]] = registers["A"];
}

function cpu_load_reg_reg16(dest, srch, srcl)
{
	last_instr_str += "LD " + dest + ", (" + srcl + srch + ")";
	var adr = ((registers[srch] & 0xFF) << 8) | (registers[srcl] & 0xFF);
	registers[dest] = memory[adr & 0xFFFF];
}

function cpu_load_a_nn(dest, srch, srcl)
{
	var adr = ((srch & 0xFF) << 8) | (srcl & 0xFF);
	last_instr_str += "LD A" + dest + ", (0x" + adr.toString(16) + ")";
	registers["A"] = memory[adr & 0xFFFF];
}

function cpu_load_reg16_reg(desth, destl, src)
{
	last_instr_str += "LD (" + desth + destl + ":), " + src;
	var adr = ((registers[desth] & 0xFF) << 8) | (registers[destl] & 0xFF);
	memory[adr & 0xFFFF] = registers[src];
}

function cpu_load_nn_reg(destl, desth, src)
{
	var adr = ((desth & 0xFF) << 8) | (destl & 0xFF);
	last_instr_str += "LD (" + adr.toString(16) + "), " + src;
	memory[adr & 0xFFFF] = registers[src];
}

function cpu_loadh_n_a(n)
{
	var adr = (0xFF00 + (n & 0xFF));
	last_instr_str += "LD (0xFF00 + 0x" + n.toString(16) + "), A";
	memory[adr & 0xFFFF] = registers["A"];
}

function cpu_loadh_a_n(n)
{
	var adr = (0xFF00 + (n & 0xFF));
	last_instr_str += "LD A, (0xFF00 + 0x" + n.toString(16) + ")";
	registers["A"] = memory[adr & 0xFFFF];
}

function cpu_loadi_hl_a()
{
	last_instr_str += "LDI (HL), A";
	var adr = ((registers["H"] & 0xFF) << 8) | (registers["L"] & 0xFF);
	memory[adr & 0xFFFF] = registers["A"];
	adr++;
	registers["H"] = (adr >> 8) & 0xFF;
	registers["L"] = adr & 0xFF;
}

function cpu_loadi_a_hl()
{
	last_instr_str += "LDI A, (HL)";
	var adr = ((registers["H"] & 0xFF) << 8) | (registers["L"] & 0xFF);
	registers["A"] = memory[adr & 0xFFFF];
	adr++;
	registers["H"] = (adr >> 8) & 0xFF;
	registers["L"] = adr & 0xFF;
}


function cpu_loadd_hl_a()
{
	var adr = ((registers["H"] & 0xFF) << 8) | (registers["L"] & 0xFF);
	last_instr_str += "LDD (HL:0x"+adr.toString(16)+"), A";
	memory[adr & 0xFFFF] = registers["A"];
	adr--;
	registers["H"] = (adr >> 8) & 0xFF;
	registers["L"] = adr & 0xFF;
}

function cpu_loadd_a_hl()
{
	last_instr_str += "LDD A, (HL)";
	var adr = ((registers["H"] & 0xFF) << 8) | (registers["L"] & 0xFF);
	registers["A"] = memory[adr & 0xFFFF];
	adr--;
	registers["H"] = (adr >> 8) & 0xFF;
	registers["L"] = adr & 0xFF;
}

function cpu_add_reg(src)
{
	last_instr_str += "ADD " + src;
	var temp = registers["A"] + registers[src];
	if((temp & 0xFF) == 0)	registers["F"] |= FLAG_Z;
	else					registers["F"] &= ~FLAG_Z;
	registers["F"] &= ~FLAG_N;
	if((temp & 0x10) == 0x10)	registers["F"] |= FLAG_H;
	else						registers["F"] &= ~FLAG_H;
	if((temp & 0x100) == 0x100)	registers["F"] |= FLAG_C;
	else						registers["F"] &= ~FLAG_C;
	
	registers["A"] = (temp & 0xFF);
}

function cpu_adc_reg(src)
{
	last_instr_str += "ADC " + src;
	var temp = registers["A"] + registers[src];
	if((registers["F"] & FLAG_C) == FLAG_C)
		temp += 1;

	if((temp & 0xFF) == 0)	registers["F"] |= FLAG_Z;
	else					registers["F"] &= ~FLAG_Z;
	registers["F"] &= ~FLAG_N;
	if((temp & 0x10) == 0x10)	registers["F"] |= FLAG_H;
	else						registers["F"] &= ~FLAG_H;
	if((temp & 0x100) == 0x100)	registers["F"] |= FLAG_C;
	else						registers["F"] &= ~FLAG_C;
	
	registers["A"] = (temp & 0xFF);
}

function cpu_add_hl()
{
	last_instr_str += "ADD (HL)";
	var adr = ((registers["H"] & 0xFF) << 8) | (registers["L"] & 0xFF);
	var temp = registers["A"] + memory[adr & 0xFFFF];
	if((temp & 0xFF) == 0)	registers["F"] |= FLAG_Z;
	else					registers["F"] &= ~FLAG_Z;
	registers["F"] &= ~FLAG_N;
	if((temp & 0x10) == 0x10)	registers["F"] |= FLAG_H;
	else						registers["F"] &= ~FLAG_H;
	if((temp & 0x100) == 0x100)	registers["F"] |= FLAG_C;
	else						registers["F"] &= ~FLAG_C;
	
	registers["A"] = (temp & 0xFF);
}

function cpu_add_hl_reg16(desth, destl)
{
	last_instr_str += "ADD HL, " + desth + destl;
	var val = ((registers[desth] & 0xFF) << 8) | (registers[destl] & 0xFF);
	var temp = ((registers["H"] & 0xFF) << 8) | (registers["L"] & 0xFF);
	temp = (temp + val) & 0xFFFF;
	registers["H"] = (temp >> 8) & 0xFF;
	registers["L"] = (temp & 0xFF); 
}

function cpu_add_hl_sp()
{
	last_instr_str += "ADD HL, SP";
	var temp = ((registers["H"] & 0xFF) << 8) | (registers["L"] & 0xFF);
	temp = (temp + registers["SP"]) & 0xFFFF;
	registers["H"] = (temp >> 8) & 0xFF;
	registers["L"] = (temp & 0xFF); 
}

function cpu_sub_reg(src)
{
	last_instr_str += "SUB " + src;
	var temp = registers["A"] - registers[src];
	if((temp & 0xFF) == 0)	registers["F"] |= FLAG_Z;
	else					registers["F"] &= ~FLAG_Z;
	registers["F"] &= ~FLAG_N;
	if((temp & 0x10) == 0x10)	registers["F"] |= FLAG_H;
	else						registers["F"] &= ~FLAG_H;
	if((temp & 0x100) == 0x100)	registers["F"] |= FLAG_C;
	else						registers["F"] &= ~FLAG_C;
	
	registers["A"] = (temp & 0xFF);
}

function cpu_sub_n(src)
{
	last_instr_str += "SUB 0x" + src.toString(16);
	var temp = registers["A"] - src;
	if((temp & 0xFF) == 0)	registers["F"] |= FLAG_Z;
	else					registers["F"] &= ~FLAG_Z;
	registers["F"] &= ~FLAG_N;
	if((temp & 0x10) == 0x10)	registers["F"] |= FLAG_H;
	else						registers["F"] &= ~FLAG_H;
	if((temp & 0x100) == 0x100)	registers["F"] |= FLAG_C;
	else						registers["F"] &= ~FLAG_C;
	
	registers["A"] = (temp & 0xFF);
}

function cpu_sbc_reg(src)
{
	last_instr_str += "SBC " + src;
	var temp = registers["A"] - registers[src];
	if((registers["F"] & FLAG_C) == FLAG_C)
		temp -= 1;

	if((temp & 0xFF) == 0)	registers["F"] |= FLAG_Z;
	else					registers["F"] &= ~FLAG_Z;
	registers["F"] &= ~FLAG_N;
	if((temp & 0x10) == 0x10)	registers["F"] |= FLAG_H;
	else						registers["F"] &= ~FLAG_H;
	if((temp & 0x100) == 0x100)	registers["F"] |= FLAG_C;
	else						registers["F"] &= ~FLAG_C;
	
	registers["A"] = (temp & 0xFF);
}

function cpu_sub_hl()
{
	last_instr_str += "SUB (HL)";
	var adr = ((registers["H"] & 0xFF) << 8) | (registers["L"] & 0xFF);
	var temp = registers["A"] - memory[adr & 0xFFFF];
	if((temp & 0xFF) == 0)	registers["F"] |= FLAG_Z;
	else					registers["F"] &= ~FLAG_Z;
	registers["F"] &= ~FLAG_N;
	if((temp & 0x10) == 0x10)	registers["F"] |= FLAG_H;
	else						registers["F"] &= ~FLAG_H;
	if((temp & 0x100) == 0x100)	registers["F"] |= FLAG_C;
	else						registers["F"] &= ~FLAG_C;
	
	registers["A"] = (temp & 0xFF);
}

function cpu_and_reg(src)
{
	last_instr_str += "AND " + src;
	var temp = registers["A"] & registers[src];
	if((temp & 0xFF) == 0)	registers["F"] |= FLAG_Z;
	else					registers["F"] &= ~FLAG_Z;
	registers["F"] &= ~FLAG_N;
	registers["F"] &= FLAG_H;
	registers["F"] &= ~FLAG_C;
}

function cpu_and_hl()
{
	last_instr_str += "AND (HL)";
	var adr = ((registers["H"] & 0xFF) << 8) | (registers["L"] & 0xFF);
	var temp = registers["A"] & registers[adr & 0xFFFF];
	if((temp & 0xFF) == 0)	registers["F"] |= FLAG_Z;
	else					registers["F"] &= ~FLAG_Z;
	registers["F"] &= ~FLAG_N;
	registers["F"] &= FLAG_H;
	registers["F"] &= ~FLAG_C;
}

function cpu_and_n(n)
{
	last_instr_str += "AND 0x" + n.toString(16);
	var temp = registers["A"] & n;
	if((temp & 0xFF) == 0)	registers["F"] |= FLAG_Z;
	else					registers["F"] &= ~FLAG_Z;
	registers["F"] &= ~FLAG_N;
	registers["F"] &= FLAG_H;
	registers["F"] &= ~FLAG_C;
}

function cpu_xor_reg(src)
{
	last_instr_str += "XOR " + src;
	var temp = registers["A"] ^ registers[src];
	if((temp & 0xFF) == 0)	registers["F"] |= FLAG_Z;
	else					registers["F"] &= ~FLAG_Z;
	registers["F"] &= ~FLAG_N;
	registers["F"] &= ~FLAG_H;
	registers["F"] &= ~FLAG_C;
}

function cpu_xor_hl()
{
	last_instr_str += "XOR (HL)";
	var adr = ((registers["H"] & 0xFF) << 8) | (registers["L"] & 0xFF);
	var temp = registers["A"] ^ registers[adr & 0xFFFF];
	if((temp & 0xFF) == 0)	registers["F"] |= FLAG_Z;
	else					registers["F"] &= ~FLAG_Z;
	registers["F"] &= ~FLAG_N;
	registers["F"] &= ~FLAG_H;
	registers["F"] &= ~FLAG_C;
}

function cpu_xor_n(n)
{
	last_instr_str += "XOR 0x" + n.toString(16);
	var temp = registers["A"] ^ n;
	if((temp & 0xFF) == 0)	registers["F"] |= FLAG_Z;
	else					registers["F"] &= ~FLAG_Z;
	registers["F"] &= ~FLAG_N;
	registers["F"] &= ~FLAG_H;
	registers["F"] &= ~FLAG_C;
}

function cpu_or_reg(src)
{
	last_instr_str += "OR " + src;
	var temp = registers["A"] | registers[src];
	if((temp & 0xFF) == 0)	registers["F"] |= FLAG_Z;
	else					registers["F"] &= ~FLAG_Z;
	registers["F"] &= ~FLAG_N;
	registers["F"] &= ~FLAG_H;
	registers["F"] &= ~FLAG_C;
}

function cpu_or_hl()
{
	last_instr_str += "OR (HL)";
	var adr = ((registers["H"] & 0xFF) << 8) | (registers["L"] & 0xFF);
	var temp = registers["A"] | registers[adr & 0xFFFF];
	if((temp & 0xFF) == 0)	registers["F"] |= FLAG_Z;
	else					registers["F"] &= ~FLAG_Z;
	registers["F"] &= ~FLAG_N;
	registers["F"] &= ~FLAG_H;
	registers["F"] &= ~FLAG_C;
}

function cpu_or_n(n)
{
	last_instr_str += "OR 0x" + n.toString(16);
	var temp = registers["A"] | n;
	if((temp & 0xFF) == 0)	registers["F"] |= FLAG_Z;
	else					registers["F"] &= ~FLAG_Z;
	registers["F"] &= ~FLAG_N;
	registers["F"] &= ~FLAG_H;
	registers["F"] &= ~FLAG_C;
}

function cpu_rl_reg(dest)
{
	last_instr_str += "RL" + dest;
	var temp = 0;
	if((registers["F"] & FLAG_C) == FLAG_C)	temp = 1;
	if((registers[dest] & 0x80) == 0x80)	registers["F"] |= FLAG_C;
	else									registers["F"] &= ~FLAG_C;
	registers["F"] &= ~FLAG_N;
	registers["F"] &= ~FLAG_H;
	registers[dest] = ((registers[dest] << 1) | temp) & 0xFF;
}

function cpu_rla()
{
	last_instr_str += "RLA";
	var temp = 0;
	if((registers["F"] & FLAG_C) == FLAG_C)	temp = 1;
	if((registers["A"] & 0x80) == 0x80)	registers["F"] |= FLAG_C;
	else								registers["F"] &= ~FLAG_C;
	registers["F"] &= ~FLAG_N;
	registers["F"] &= ~FLAG_H;
	registers["A"] = ((registers["A"] << 1) | temp) & 0xFF;
}

function cpu_rra()
{
	last_instr_str += "RRA";
	var temp = 0;
	if((registers["F"] & FLAG_C) == FLAG_C)	temp = 0x80;
	if((registers["A"] & 0x80) == 0x80)	registers["F"] |= FLAG_C;
	else								registers["F"] &= ~FLAG_C;
	registers["F"] &= ~FLAG_N;
	registers["F"] &= ~FLAG_H;
	registers["A"] = ((registers["A"] >> 1) | temp) & 0xFF;
}

function cpu_rlca()
{
	last_instr_str += "RLCA";
	var temp = 0;
	if((registers["A"] & 0x80) == 0x80)	registers["F"] |= FLAG_C;
	else								registers["F"] &= ~FLAG_C;

	if((registers["F"] & FLAG_C) == FLAG_C)	temp = 1;

	registers["F"] &= ~FLAG_N;
	registers["F"] &= ~FLAG_H;
	registers["A"] = ((registers["A"] << 1) | temp) & 0xFF;
}

function cpu_rrca()
{
	last_instr_str += "RRCA";
	var temp = 0;
	if((registers["A"] & 0x80) == 0x80)	registers["F"] |= FLAG_C;
	else								registers["F"] &= ~FLAG_C;

	if((registers["F"] & FLAG_C) == FLAG_C)	temp = 0x80;

	registers["F"] &= ~FLAG_N;
	registers["F"] &= ~FLAG_H;
	registers["A"] = ((registers["A"] >> 1) | temp) & 0xFF;
}

function cpu_bitr(bit, reg)
{
	last_instr_str += "BIT " + bit + ", " + reg;
	if(((0x01 << bit) & registers[reg]) == 0x00)	registers["F"] |= FLAG_Z;
	else											registers["F"] &= ~FLAG_Z;
   registers["F"] &= ~FLAG_N;
   registers["F"] |= FLAG_H;
}


function cpu_print_flag(tf, flag)
{
	if(!tf) last_instr_str += "N"; 
	switch(flag)
	{
		case FLAG_C : last_instr_str += "C"; break;
		case FLAG_H : last_instr_str += "H"; break;
		case FLAG_Z : last_instr_str += "Z"; break;
		case FLAG_N : last_instr_str += "N"; break;
		default :     last_instr_str += "?"; break;
	}
}

function cpu_jumpr_c(tf, flag, offset)
{
	offset &= 0xFF;
	last_instr_str += "JR "; cpu_print_flag(tf, flag); last_instr_str += ", 0x" + offset.toString(16) + " : ";
	if((registers["F"] & flag) == (tf ? flag : 0x00))
	{
		last_instr_str += "true";
		if(offset > 128)
			offset -= 256;
		registers["PC"] += offset;
	}
	else last_instr_str += "false";
}

function cpu_jumpr(offset)
{
	offset &= 0xFF;
	last_instr_str += "JR 0x" + offset.toString(16);

	if(offset > 128)
		offset -= 256;
	registers["PC"] += offset;
}

function cpu_jump(destl, desth)
{
	var val = (((desth & 0xFF) << 8) | (destl & 0xFF)) & 0xFFFF;
	last_instr_str += "JP 0x" + val.toString(16);
	registers["PC"] = val;
}

function cpu_inc_reg(dest)
{
	last_instr_str += "INC " + dest;
	var temp = registers[dest]+1;
	if((temp & 0xFF) == 0)	registers["F"] |= FLAG_Z;
	else					registers["F"] &= ~FLAG_Z;
	registers["F"] &= ~FLAG_N;
	if((temp & 0x10) == 0x10)	registers["F"] |= FLAG_H;
	else						registers["F"] &= ~FLAG_H;
	registers[dest] = temp & 0xFF;
}

function cpu_inc_reg16(desth, destl)
{
	last_instr_str += "INC " + desth + destl;
	var temp = (registers[desth] & 0xFF) << 8 | (registers[destl] & 0xFF);
	temp = (temp + 1) & 0xFFFF;
	registers[desth] = (temp >> 8) & 0xFF;
	registers[destl] = (temp & 0xFF);
}

function cpu_inc_sp()
{
	last_instr_str += "INC SP";
	var temp = (registers["SP"] & 0xFFFF);
	registers["SP"] = (temp + 1) & 0xFFFF;
}

function cpu_inc_hl()
{
	last_instr_str += "INC (HL)";
	var adr = ((registers["H"] & 0xFF) << 8) | (registers["L"] & 0xFF);
	var temp = (memory[adr & 0xFFFF] + 1) & 0xFFFF;

	if((temp & 0xFF) == 0)	registers["F"] |= FLAG_Z;
	else					registers["F"] &= ~FLAG_Z;
	registers["F"] &= ~FLAG_N;
	if((temp & 0x10) == 0x10)	registers["F"] |= FLAG_H;
	else						registers["F"] &= ~FLAG_H;
	
	registers["H"] = (temp >> 8) & 0xFF;
	registers["L"] = (temp & 0xFF);
}

function cpu_dec_reg(dest)
{
	last_instr_str += "DEC " + dest;
	var temp = registers[dest]-1;
	if((temp & 0xFF) == 0)	registers["F"] |= FLAG_Z;
	else					registers["F"] &= ~FLAG_Z;
	registers["F"] |= FLAG_N;
	registers["F"] &= ~FLAG_H;
	registers[dest] = temp & 0xFF;
}

function cpu_dec_reg16(desth, destl)
{
	last_instr_str += "DEC " + desth + destl;
	var temp = (registers[desth] & 0xFF) << 8 | (registers[destl] & 0xFF);
	temp = (temp - 1) & 0xFFFF;
	registers[desth] = (temp >> 8) & 0xFF;
	registers[destl] = (temp & 0xFF);
}

function cpu_dec_sp()
{
	last_instr_str += "DEC SP";
	var temp = (registers["SP"] & 0xFFFF);
	registers["SP"] = (temp - 1) & 0xFFFF;
}

function cpu_dec_hl()
{
	last_instr_str += "DEC (HL)";
	var adr = ((registers["H"] & 0xFF) << 8) | (registers["L"] & 0xFF);
	var temp = (memory[adr & 0xFFFF] - 1) & 0xFFFF;

	if((temp & 0xFF) == 0)	registers["F"] |= FLAG_Z;
	else					registers["F"] &= ~FLAG_Z;
	registers["F"] |= FLAG_N;
	registers["F"] &= ~FLAG_H;
	
	registers["H"] = (temp >> 8) & 0xFF;
	registers["L"] = (temp & 0xFF);
}
function cpu_call(nl, nh)
{
	var temp = ((nh & 0xFF) << 8) | (nl & 0xFF) & 0xFFFF;
	last_instr_str += "CALL 0x" + temp.toString(16);
	call_depth += ">";
	memory[--registers["SP"]] = ((registers["PC"] >> 8) & 0xFF);
	memory[--registers["SP"]] = (registers["PC"] & 0xFF);
	registers["PC"] = temp;
}

function cpu_ret()
{
	last_instr_str += "RET";
	if(call_depth.length > 0)
		call_depth = call_depth.substring(call_depth.length, 1);
	var pcl = memory[registers["SP"]++] & 0xFF;
	var pch = memory[registers["SP"]++] & 0xFF;
	registers["PC"] = ((pch << 8) | pcl) & 0xFFFF;
}

function cpu_ret_c(tf, flag)
{
	last_instr_str += "RET ";
	cpu_print_flag(tf, flag);
	if((registers["F"] & flag) == (tf ? flag : 0x00))
	{
		last_instr_str += ": true";
		if(call_depth.length > 0)
			call_depth = call_depth.substring(call_depth.length, 1);
		var pcl = memory[registers["SP"]++] & 0xFF;
		var pch = memory[registers["SP"]++] & 0xFF;
		registers["PC"] = ((pch << 8) | pcl) & 0xFFFF;
	}
	else last_instr_str += ": false";
}

function cpu_push(regh, regl)
{
	last_instr_str += "PUSH " + regl + regh;
	memory[--registers["SP"]] = (registers[regh] & 0xFF);
	memory[--registers["SP"]] = (registers[regl] & 0xFF);
}

function cpu_pop(regh, regl)
{
	last_instr_str += "POP " + regl + regh;
	registers[regl] = memory[registers["SP"]++];
	registers[regh] = memory[registers["SP"]++];
}

function cpu_cp_n(n)
{
	last_instr_str += "CP 0x" + n.toString(16);
	var temp = registers["A"] - n;
	if((temp & 0xFF) == 0)	registers["F"] |= FLAG_Z;
	else					registers["F"] &= ~FLAG_Z;
	registers["F"] &= ~FLAG_N;
	if((temp & 0x10) == 0x10)	registers["F"] |= FLAG_H;
	else						registers["F"] &= ~FLAG_H;
	if((temp & 0x100) == 0x100)	registers["F"] |= FLAG_C;
	else						registers["F"] &= ~FLAG_C;
}

function cpu_cp_reg(reg)
{
	last_instr_str += "CP " + reg;
	var temp = registers["A"] - registers[reg];
	if((temp & 0xFF) == 0)	registers["F"] |= FLAG_Z;
	else					registers["F"] &= ~FLAG_Z;
	registers["F"] &= ~FLAG_N;
	if((temp & 0x10) == 0x10)	registers["F"] |= FLAG_H;
	else						registers["F"] &= ~FLAG_H;
	if((temp & 0x100) == 0x100)	registers["F"] |= FLAG_C;
	else						registers["F"] &= ~FLAG_C;
}

function cpu_cp_hl()
{
	last_instr_str += "CP (HL)";
	var adr = ((registers["H"] & 0xFF) << 8) | (registers["L"] & 0xFF);
	var temp = registers["A"] - memory[adr & 0xFFFF];
	if((temp & 0xFF) == 0)	registers["F"] |= FLAG_Z;
	else					registers["F"] &= ~FLAG_Z;
	registers["F"] &= ~FLAG_N;
	if((temp & 0x10) == 0x10)	registers["F"] |= FLAG_H;
	else						registers["F"] &= ~FLAG_H;
	if((temp & 0x100) == 0x100)	registers["F"] |= FLAG_C;
	else						registers["F"] &= ~FLAG_C;
}

function cpu_ei()
{
	IME = true;
}

function cpu_di()
{
	IME = false;
}

function cpu_cpl()
{
	last_instr += "CPL";
	registers["A"] = (registers["A"] ^ 0xFF) & 0xFF;

	registers["F"] |= FLAG_N;
	registers["F"] |= FLAG_H;
}

function cpu_loop()
{
	var ticks = 0;
	
	while(ticks++ < 100)
	{
		if(run)
			cpu_cycle();
	}
}

function mem_dump()
{
	for(var i = 0; i < Math.min(memory.length, 0x1000); i++)
	{
		if(i == registers["PC"])
		{
			document.getElementById("memdump").innerHTML += "[";
		}
		document.getElementById("memdump").innerHTML += "0x" + memory[i].toString(16);
		if(i == registers["PC"])
		{
			document.getElementById("memdump").innerHTML += "]";
		}
		document.getElementById("memdump").innerHTML += " ";
	}
}

function stack_trace()
{
	var up_bound = Math.min(0xFFFF, registers["SP"] + 8);
	var low_bound = Math.max(0, registers["SP"] - 8);
	
	var strace_lnode;
	var strace_tnode;
	for(var i = low_bound; i < registers["SP"]; ++i)
	{
		strace_lnode = document.createElement("li");
		strace_tnode = document.createTextNode("0x" + i.toString(16) + ": 0x" + memory[i].toString(16));
		strace_lnode.appendChild(strace_tnode);
		document.getElementById("stacktrace").appendChild(strace_lnode);
	}
	
	strace_lnode = document.createElement("li");
	strace_tnode = document.createTextNode("0x" + registers["SP"].toString(16) + ": 0x" + memory[registers["SP"]].toString(16) + " <----");
	strace_lnode.appendChild(strace_tnode);
	document.getElementById("stacktrace").appendChild(strace_lnode);
	
	for(var i = registers["SP"]+1; i < up_bound; ++i)
	{
		strace_lnode = document.createElement("li");
		strace_tnode = document.createTextNode("0x" + i.toString(16) + ": 0x" + memory[i].toString(16));
		strace_lnode.appendChild(strace_tnode);
		document.getElementById("stacktrace").appendChild(strace_lnode);
	}
}
